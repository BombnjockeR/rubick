// Skinned, animated characters: the rigged animals built by art/animals.py
// (bunny, dog, cat, panda, chimp, lioness).
//
//   MabarChars.load('bunny')                  // Promise; rejects if the .glb can't load
//     .then(() => {
//       const c = MabarChars.create('bunny', { position: [0, 0, 2], rotationY: Math.PI, scale: 1.8 });
//       scene.add(c.root);
//       c.setSpeed(2.5);                       // idle / walk / run, blended by speed (m/s)
//       c.setVelocity(vx, vz);                 // or a world velocity: sideways moves shuffle
//       c.setStance('ready');                  // stand in the tennis ready position instead of idle
//       c.play('jump');                        // full-body one-shot, then back to moving
//       c.swing();                             // upper-body swing over whatever the legs do
//       c.play('diveR', { contact: 0.2 });     // a hitting clip timed so its racket meets the ball in 0.2 s
//       c.update(dt);                          // every frame
//     });
//
// Clips in every character file (art/clips.py): idle, ready, walk, run, strafeL,
// strafeR (blended by speed and direction), jump, victory, defeat, smash, lungeL/R,
// diveL/R (full-body, via play()), swing, serve (upper body, via setReady() /
// swing()). Tools are meshes named prop_<tool> (racket, paddle); one is shown at a
// time with setTool(), and toolHead() says where its head (the strings, the blade)
// is. Sockets (bones with no skin weights) hold accessories: sockHat, sockBack,
// sockHandL, sockHandR.
window.MabarChars = (() => {
  'use strict';

  // Asset-level calibration lives here; games pass their own position/rotation/scale.
  const defs = {
    bunny: {
      name: 'Bunny',
      url: 'assets/bunny.glb',
      height: 1.0,          // model units, ears included
      scale: 1,             // asset units -> meters before the game's own scale
      offset: [0, 0, 0],    // model offset inside the character root
      rotationY: 0,         // the model faces +Z (glTF), like the chibi characters
      // Speeds (model units/s) at which walk, run and the side shuffle play at 1x with
      // the planted foot still: art/clips.py WALK_STRIDE, RUN_STRIDE, STRAFE_STEP.
      walkSpeed: 0.375, runSpeed: 0.99, strafeSpeed: 0.44,
      tool: 'racket',       // prop_* mesh shown by default
      outfits: { default: {} },
    },
    dog: {
      name: 'Pup',
      url: 'assets/dog.glb',
      height: 1.0,
      scale: 1,
      offset: [0, 0, 0],
      rotationY: 0,
      walkSpeed: 0.375, runSpeed: 0.99, strafeSpeed: 0.44,
      tool: 'racket',
      outfits: { default: {} },
    },
    // The T-posed models (art/animals.py 'auto' entries): same skeleton, same clips,
    // a generated racket and paddle in the right fist.
    cat: { name: 'Cat', url: 'assets/cat.glb', height: 1.0, scale: 1, offset: [0, 0, 0], rotationY: 0, walkSpeed: 0.375, runSpeed: 0.99, strafeSpeed: 0.44, tool: 'racket', outfits: { default: {} } },
    panda: { name: 'Panda', url: 'assets/panda.glb', height: 1.0, scale: 1, offset: [0, 0, 0], rotationY: 0, walkSpeed: 0.375, runSpeed: 0.99, strafeSpeed: 0.44, tool: 'racket', outfits: { default: {} } },
    chimp: { name: 'Chimp', url: 'assets/chimp.glb', height: 1.0, scale: 1, offset: [0, 0, 0], rotationY: 0, walkSpeed: 0.375, runSpeed: 0.99, strafeSpeed: 0.44, tool: 'racket', outfits: { default: {} } },
    lioness: { name: 'Lioness', url: 'assets/lioness.glb', height: 1.0, scale: 1, offset: [0, 0, 0], rotationY: 0, walkSpeed: 0.375, runSpeed: 0.99, strafeSpeed: 0.44, tool: 'racket', outfits: { default: {} } },
  };

  const BASE = ['idle', 'ready', 'walk', 'run', 'strafeL', 'strafeR'];   // loops weighted by update()
  const LAYERED = ['swing', 'serve'];        // upper-body one-shots, sampled per bone
  const ONCE = ['jump', 'swing', 'serve', 'smash', 'lungeL', 'lungeR', 'diveL', 'diveR'];
  const CLIPS = ['idle', 'ready', 'walk', 'run', 'strafeL', 'strafeR', 'jump', 'victory', 'defeat', 'swing', 'serve',
    'smash', 'lungeL', 'lungeR', 'diveL', 'diveR'];
  // Seconds into each hitting clip where the racket meets the ball (art/clips.py CONTACT, frames at 30 fps).
  const CONTACT = { swing: 4 / 30, serve: 9 / 30, smash: 7 / 30, lungeL: 5 / 30, lungeR: 5 / 30, diveL: 5 / 30, diveR: 5 / 30 };
  const UPPER = ['spine', 'chest', 'head', 'armL', 'forearmL', 'handL', 'armR', 'forearmR', 'handR'];
  const loaded = new Map();   // id -> { gltf, clips }
  const failed = new Map();   // id -> error
  const warned = new Set();
  const scratch = new Map();  // id -> hidden Character that reachOf() poses
  const reaches = new Map();  // reachOf() results

  function warnOnce(key, ...msg) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn('[mabar] character', ...msg);
  }

  // SkinnedMesh-safe deep clone (three's SkeletonUtils.clone is not in the vendor bundle).
  function cloneSkinned(source) {
    const clone = source.clone(true);
    const pairs = new Map();
    (function walk(a, b) {
      pairs.set(a, b);
      for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]);
    })(source, clone);
    for (const [src, dst] of pairs) {
      if (!src.isSkinnedMesh) continue;
      const bones = src.skeleton.bones.map((bone) => pairs.get(bone));
      dst.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix);
    }
    return clone;
  }

  const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // How to run a hitting clip so its contact frame (`at` s in) comes `contact` s from
  // now: from where and how fast (0.4x-2.5x; a ball that is nearly there starts the
  // clip further in, one still far off just gets a slower wind-up).
  function timing(at, from, contact, base = 1) {
    if (at == null || contact == null || at <= from) return { from, rate: base };
    if (contact <= 0.01) return { from: at, rate: base };
    let rate = (at - from) / contact;
    if (rate > 2.5) { from = at - contact * 2.5; rate = 2.5; } else if (rate < 0.4) rate = 0.4;
    return { from, rate };
  }

  class Character {
    constructor(id, def, asset, opts = {}) {
      this.id = id;
      this.def = def;
      this.root = new THREE.Group();
      this.root.name = `char_${id}`;
      this.model = cloneSkinned(asset.gltf.scene);
      this.model.scale.setScalar(def.scale);
      this.model.position.fromArray(def.offset);
      this.model.rotation.y = def.rotationY;
      this.root.add(this.model);
      this.bones = {};
      this.meshes = [];
      this.props = {};        // tool name -> objects named prop_<tool>
      this.model.traverse((o) => {
        if (o.isBone) this.bones[o.name] = o;
        const m = /^prop_(\w+?)(_\d+)?$/.exec(o.name);
        if (m && !(o.parent && o.parent.name === o.name)) (this.props[m[1]] = this.props[m[1]] || []).push(o);
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // Animated bounds change every frame; a handful of characters is cheap to draw.
          o.frustumCulled = false;
          this.meshes.push(o);
        }
      });
      // Each bone's rest orientation relative to the model (for attach()).
      this.model.updateMatrixWorld(true);
      const modelQ = this.model.getWorldQuaternion(new THREE.Quaternion());
      this.restRel = {};
      for (const [name, b] of Object.entries(this.bones)) {
        this.restRel[name] = b.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(modelQ);
      }
      // Each tool's head (the racket's strings, the paddle's blade) as a point in its
      // hand bone's frame: props are skinned rigidly to one bone, so it rides with it.
      this.heads = {};
      const sock = this.bones.sockHandR;
      for (const [name, objs] of Object.entries(this.props)) {
        let bone = null;
        const pts = [];
        for (const o of objs) o.traverse((m) => {
          if (!m.isSkinnedMesh || !m.geometry.attributes.skinIndex) return;
          const pos = m.geometry.attributes.position;
          const i = m.geometry.attributes.skinIndex.getX(0);
          const M = new THREE.Matrix4().multiplyMatrices(m.skeleton.boneInverses[i], m.bindMatrix);
          bone = m.skeleton.bones[i];
          for (let k = 0; k < pos.count; k++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(M));
        });
        if (!bone || !pts.length) continue;
        // farthest 45% from the grip (the fist) = the head
        const grip = sock ? new THREE.Vector3().setFromMatrixPosition(sock.matrixWorld).applyMatrix4(bone.matrixWorld.clone().invert()) : new THREE.Vector3();
        const d = pts.map((p) => p.distanceTo(grip)).sort((a, b) => a - b)[Math.floor(pts.length * 0.55)];
        const head = new THREE.Vector3();
        let n = 0;
        for (const p of pts) if (p.distanceTo(grip) >= d) { head.add(p); n++; }
        this.heads[name] = { bone, point: head.multiplyScalar(1 / Math.max(1, n)) };
      }
      if (opts.position) this.root.position.fromArray(opts.position);
      if (opts.rotationY != null) this.root.rotation.y = opts.rotationY;
      if (opts.scale != null) this.root.scale.setScalar(opts.scale);
      this.tool = null;
      this.setTool(opts.tool !== undefined ? opts.tool : def.tool);

      this.mixer = new THREE.AnimationMixer(this.model);
      this.actions = {};
      for (const [name, clip] of asset.clips) {
        const a = this.mixer.clipAction(clip);
        const loop = !ONCE.includes(name);
        a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        a.clampWhenFinished = !loop;
        a.enabled = true;
        a.setEffectiveWeight(name === 'idle' ? 1 : 0);
        if (!LAYERED.includes(name)) a.play();   // swing and serve are sampled by the upper-body layer
        this.actions[name] = a;
      }
      // Upper-body layer: swing / serve sampled per bone and slerped over the base pose.
      this.layers = {};
      for (const name of LAYERED) {
        const clip = asset.clips.get(name);
        if (!clip) continue;
        const tracks = [];
        for (const track of clip.tracks) {
          const [node, prop] = track.name.split('.');
          if (prop === 'quaternion' && UPPER.includes(node) && this.bones[node]) {
            tracks.push({ bone: this.bones[node], interp: track.createInterpolant(), q: new THREE.Quaternion() });
          }
        }
        if (tracks.length) this.layers[name] = { tracks, dur: clip.duration };
      }
      this.speed = 0;          // m/s forward, what the game says (setSpeed)
      this.vel = null;         // or a world velocity [vx, vz] (setVelocity)
      this.stance = 'idle';    // what standing still looks like: 'idle' or 'ready'
      this.running = false;    // walk or run gait (switches with hysteresis)
      this.blend = { idle: 1, ready: 0, walk: 0, run: 0, strafeL: 0, strafeR: 0 };
      this.overlay = null;     // { name, w, fadeIn, fadeOut, loop, stopping }
      this.readyW = 0;         // held first-frame pose weight (0..1): racket back, or the serve's trophy pose
      this.readyClip = 'swing';
      this.swingClip = 'swing';
      this.swingT = -1;        // seconds into a swing, -1 = none
      this.swingRate = 1;
      this.swingAfter = 1;     // rate after the contact frame of a timed swing
      this.swingContact = null;
      this.raiseDy = 0;        // raise(): racket arm lifted for this swing (m)
      this.lookYaw = 0;
      this.attached = new Set();
      this._tmpQ = new THREE.Quaternion();
      this._yAxis = new THREE.Vector3(0, 1, 0);
    }

    has(name) { return !!this.actions[name] || !!this.layers[name]; }

    // Locomotion: 0 = idle, walk around def.walkSpeed, run from ~def.runSpeed. Scaled
    // by the character's world scale so a bigger character takes bigger steps.
    setSpeed(mps) { this.speed = Math.max(0, mps || 0); this.vel = null; }

    // World-space velocity (m/s). Compared with where the root faces: forward plays
    // walk / run, sideways (more than ~45 degrees off) the side shuffle.
    setVelocity(vx, vz) { this.vel = [vx || 0, vz || 0]; }

    // Fastest sideways speed (m/s, at the current scale) the shuffle keeps up with;
    // past it, turn the character into the run. 0 if the file has no strafe clips.
    strafeLimit() {
      if (!this.actions.strafeL || !this.actions.strafeR) return 0;
      return (this.def.strafeSpeed || 0.44) * this.root.scale.x * this.def.scale * 1.7;
    }

    // Standing still: 'idle' (relaxed) or 'ready' (knees bent, racket up in both hands).
    setStance(name) {
      if (name !== 'idle' && !this.actions[name]) { warnOnce(`${this.id}:${name}`, `${this.id} has no clip "${name}"`); return false; }
      this.stance = name;
      return true;
    }

    // Full-body clip on top of locomotion: 'jump' (once) or 'victory' (loops until stop()).
    // A hitting clip (CONTACT) can be timed to the ball: `contact` = seconds until the
    // racket should meet it; the clip runs faster or slower until its contact frame,
    // or starts part-way in when the ball is nearly there, then plays on at 1x.
    play(name, { fade = 0.15, loop, from = 0, contact } = {}) {
      const a = this.actions[name];
      if (!a) { warnOnce(`${this.id}:${name}`, `${this.id} has no clip "${name}"`); return false; }
      const isLoop = loop != null ? loop : !ONCE.includes(name);
      a.setLoop(isLoop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !isLoop;
      a.reset();
      const t = timing(CONTACT[name], from, contact);
      a.time = t.from;
      a.timeScale = t.rate;
      a.play();
      const prev = this.overlay;
      if (prev && prev.name !== name) this.actions[prev.name].setEffectiveWeight(0);
      this.overlay = { name, w: prev ? prev.w : 0, fadeIn: fade, fadeOut: 0.25, loop: isLoop, stopping: false, contactAt: t.rate !== 1 ? CONTACT[name] : null };
      return true;
    }

    stop(fade = 0.25) { if (this.overlay) { this.overlay.stopping = true; this.overlay.fadeOut = fade; } }

    playing(name) { return !!this.overlay && this.overlay.name === name && !this.overlay.stopping; }

    // Upper body: hold the first frame of 'swing' (racket back) or 'serve' (trophy
    // pose: ball tossed, racket cocked) with weight k = 0..1 ...
    setReady(k, clip = 'swing') {
      this.readyW = clamp01(k);
      if (this.layers[clip]) this.readyClip = clip;
    }

    // ... or play one through once, in `duration` seconds, starting `from` seconds in;
    // with `contact` (seconds), timed so the racket meets the ball then (see play()).
    swing(duration, clip = 'swing', from = 0, contact) {
      const L = this.layers[clip];
      if (!L) return false;
      this.swingClip = clip;
      const rate = duration ? (L.dur - Math.min(from, L.dur)) / duration : 1;
      const t = timing(CONTACT[clip], from, contact, rate);
      this.swingT = Math.min(t.from, L.dur);
      this.swingRate = t.rate;
      this.swingAfter = rate;     // the rate once past the contact frame
      this.swingContact = t.rate !== rate ? CONTACT[clip] : null;
      this.raiseDy = 0;
      return true;
    }

    // For the swing under way: swing the racket arm up (or down) about the shoulder so
    // the tool's head meets a ball dy meters (world) above (below) the clip's own
    // contact height; it eases in up to the contact frame and out after it.
    raise(dy) { this.raiseDy = dy || 0; }

    // Where the shown tool's head (strings, blade) is in the world, or null.
    toolHead(out = new THREE.Vector3()) {
      const h = this.tool && this.heads[this.tool];
      if (!h) return null;
      h.bone.updateWorldMatrix(true, false);
      return out.copy(h.point).applyMatrix4(h.bone.matrixWorld);
    }

    look(yaw) { this.lookYaw = yaw; }

    // Show one tool (prop_<name> meshes, e.g. 'racket' or 'paddle'); null hides them all.
    setTool(name) {
      if (name && !this.props[name]) { warnOnce(`${this.id}:tool:${name}`, `${this.id} has no tool "${name}"`); return false; }
      for (const [k, objs] of Object.entries(this.props)) for (const o of objs) o.visible = k === name;
      this.tool = name || null;
      return true;
    }

    bone(name) { return this.bones[name] || null; }

    // Accessories: parented to a socket bone and posed in the character's own axes
    // (Y up, facing +Z), whatever the socket bone's orientation; `position` is in
    // model units from the socket.
    attach(socket, obj, { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {}) {
      const b = this.bones[socket];
      if (!b) { warnOnce(`${this.id}:${socket}`, `${this.id} has no socket "${socket}"`); return false; }
      const rel = this.restRel[socket];
      obj.quaternion.copy(rel).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)));
      obj.position.fromArray(position).applyQuaternion(rel);
      obj.scale.setScalar(scale);
      b.add(obj);
      this.attached.add(obj);
      return true;
    }

    detach(obj) {
      if (obj.parent) obj.parent.remove(obj);
      this.attached.delete(obj);
    }

    // Outfits: a named entry in the definition, e.g. { texture: 'assets/x.jpg', accessories: [...] }.
    wear(name) {
      const o = this.def.outfits && this.def.outfits[name];
      if (!o) { warnOnce(`${this.id}:outfit:${name}`, `${this.id} has no outfit "${name}"`); return Promise.resolve(false); }
      const jobs = [];
      if (o.texture) {
        jobs.push(new Promise((res) => new THREE.TextureLoader().load(o.texture, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = false;
          for (const m of this.meshes) { m.material = m.material.clone(); m.material.map = tex; m.material.needsUpdate = true; }
          res(true);
        }, undefined, () => { warnOnce(o.texture, `outfit texture failed: ${o.texture}`); res(false); })));
      }
      for (const acc of o.accessories || []) {
        jobs.push(Kit3D.load(acc.url).then((g) => {
          const src = acc.node ? g.scene.getObjectByName(acc.node) : g.scene;
          if (src) this.attach(acc.socket, src.clone(true), acc);
          return !!src;
        }).catch(() => { warnOnce(acc.url, `accessory failed: ${acc.url}`); return false; }));
      }
      return Promise.all(jobs).then((r) => r.every(Boolean));
    }

    update(dt) {
      const d = this.def;
      // Speed in model units/s, split into forward and sideways by the root's facing.
      const scale = Math.max(1e-3, this.root.scale.x * d.scale);
      let fwd = this.speed, lat = 0;
      if (this.vel) {
        const a = this.root.rotation.y + d.rotationY, [vx, vz] = this.vel;
        fwd = vx * Math.sin(a) + vz * Math.cos(a);
        lat = vx * Math.cos(a) - vz * Math.sin(a);       // + toward the character's left
      }
      fwd /= scale;
      lat /= scale;
      const v = Math.hypot(fwd, lat);
      const ss = d.strafeSpeed || 0.44;
      // Share of the side shuffle: 0 up to 30 degrees off the facing, 1 beyond 60.
      const side = this.actions.strafeL && this.actions.strafeR && v > 1e-4
        ? clamp01((Math.atan2(Math.abs(lat), fwd) - Math.PI / 6) / (Math.PI / 6)) : 0;
      // Forward: stand -> walk blend, then walk or run. Walk and run plant their feet at
      // different points of the stride, so a steady mix of the two would slide: switch
      // (with hysteresis, at a slow-jog speed) and let the smoothing below cross-fade.
      if (this.running ? v < d.runSpeed * 0.62 : v > d.runSpeed * 0.72) this.running = !this.running;
      const f = { stand: 0, walk: 0, run: 0 };
      const w0 = d.walkSpeed * 0.25, w1 = d.walkSpeed;
      if (this.running) f.run = 1;
      else if (v <= w0) f.stand = 1;
      else if (v < w1) { f.walk = (v - w0) / (w1 - w0); f.stand = 1 - f.walk; }
      else f.walk = 1;
      const shuffle = clamp01((v - ss * 0.1) / (ss * 0.3));
      const tw = { idle: 0, ready: 0, walk: (1 - side) * f.walk, run: (1 - side) * f.run, strafeL: 0, strafeR: 0 };
      tw[lat >= 0 ? 'strafeL' : 'strafeR'] = side * shuffle;
      tw[this.stance === 'ready' && this.actions.ready ? 'ready' : 'idle'] = (1 - side) * f.stand + side * (1 - shuffle);
      for (const k of BASE) this.blend[k] = smooth(this.blend[k], tw[k], 10, dt);
      const walk = this.actions.walk, run = this.actions.run;
      // Played faster or slower with the speed so the planted foot keeps its grip.
      if (walk) walk.timeScale = Math.min(2.2, Math.max(0.7, v / d.walkSpeed));
      if (run) run.timeScale = Math.min(2.6, Math.max(0.6, v / d.runSpeed));
      for (const k of ['strafeL', 'strafeR']) {
        if (this.actions[k]) this.actions[k].timeScale = Math.min(2.0, Math.max(0.6, v / ss));
      }
      if (walk && run) {   // the stronger of the two sets the stride phase for both (left foot lands at 0)
        const [lead, follow] = this.blend.run > this.blend.walk ? [run, walk] : [walk, run];
        follow.time = (lead.time / lead.getClip().duration) * follow.getClip().duration;
      }

      // Full-body overlay fades in, and out when stopped or near the end of a one-shot.
      let ow = 0;
      const ov = this.overlay;
      if (ov) {
        const a = this.actions[ov.name];
        if (ov.contactAt != null && a.time >= ov.contactAt) { a.timeScale = 1; ov.contactAt = null; }   // past the ball: real speed
        const left = a.getClip().duration - a.time;
        const ending = ov.stopping || (!ov.loop && left < ov.fadeOut);
        ov.w = ending ? Math.max(0, ov.w - dt / ov.fadeOut) : Math.min(1, ov.w + dt / Math.max(1e-3, ov.fadeIn));
        if (ending && ov.w <= 0) { a.setEffectiveWeight(0); a.stop(); this.overlay = null; } else ow = ov.w;
      }
      const live = BASE.filter((k) => this.actions[k]);
      const sum = live.reduce((n, k) => n + this.blend[k], 0) || 1;
      for (const k of live) this.actions[k].setEffectiveWeight((this.blend[k] / sum) * (1 - ow));
      if (this.overlay) this.actions[this.overlay.name].setEffectiveWeight(ow);

      this.mixer.update(dt);

      // Upper-body layer: the swing / serve in progress, otherwise the held first frame.
      let L = null, t = 0, w = 0;
      if (this.swingT >= 0) {
        L = this.layers[this.swingClip];
        if (this.swingContact != null && this.swingT >= this.swingContact) { this.swingRate = this.swingAfter; this.swingContact = null; }
        this.swingT += dt * this.swingRate;
        t = this.swingT;
        const end = L.dur;
        w = t < end * 0.7 ? 1 : Math.max(0, 1 - (t - end * 0.7) / (end * 0.3));
        if (t >= end) this.swingT = -1;
      } else if (this.readyW > 0) {
        L = this.layers[this.readyClip];
        w = this.readyW;
      }
      if (L && w > 0 && !(ov && ov.w > 0.5)) {
        for (const l of L.tracks) {
          l.q.fromArray(l.interp.evaluate(Math.min(t, L.dur)));
          l.bone.quaternion.slerp(l.q, w);
        }
        const c = CONTACT[this.swingClip];
        if (this.raiseDy && this.swingT >= 0 && c) {
          const k = t <= c ? clamp01(t / c) : clamp01(1 - (t - c) / 0.2);
          if (k > 0) this.liftArm(this.raiseDy * k * w);
        }
      }
      if (this.lookYaw && this.bones.head) {
        this.bones.head.quaternion.premultiply(this._tmpQ.setFromAxisAngle(this._yAxis, this.lookYaw));
      }
    }

    // Turn the racket arm about the shoulder so the tool's head moves dy meters up
    // (world), keeping the arm's length (see raise()).
    liftArm(dy) {
      const h = this.tool && this.heads[this.tool], arm = this.bones.armR;
      if (!h || !arm || !arm.parent) return;
      h.bone.updateWorldMatrix(true, false);
      const sh = this._v1 = (this._v1 || new THREE.Vector3()).setFromMatrixPosition(arm.matrixWorld);
      const a = (this._v2 = this._v2 || new THREE.Vector3()).copy(h.point).applyMatrix4(h.bone.matrixWorld).sub(sh);
      const b = (this._v3 = this._v3 || new THREE.Vector3()).copy(a);
      b.y += dy;
      const q = (this._q1 = this._q1 || new THREE.Quaternion()).setFromUnitVectors(a.normalize(), b.normalize());
      const p = arm.parent.getWorldQuaternion(this._q2 = this._q2 || new THREE.Quaternion());
      arm.quaternion.premultiply((this._q3 = this._q3 || new THREE.Quaternion()).copy(p).invert().multiply(q).multiply(p));
    }

    dispose() {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.model);
      this.model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); }); // per-clone bone textures
      for (const o of this.attached) this.detach(o);
      if (this.root.parent) this.root.parent.remove(this.root);
    }
  }

  return {
    defs,

    // Add or replace a character: { name, url, height, scale, offset, rotationY, walkSpeed, runSpeed, strafeSpeed, tool, outfits }.
    define(id, def) {
      defs[id] = Object.assign({ name: id, scale: 1, offset: [0, 0, 0], rotationY: 0, walkSpeed: 0.375, runSpeed: 0.99, strafeSpeed: 0.44, height: 1, tool: null, outfits: { default: {} } }, def);
    },

    // Resolves when the character's .glb is loaded; rejects (once per page) if it can't be.
    load(id, onProgress) {
      const def = defs[id];
      if (!def) return Promise.reject(new Error(`unknown character "${id}"`));
      if (loaded.has(id)) return Promise.resolve(loaded.get(id));
      return Kit3D.load(def.url, onProgress).then((gltf) => {
        const clips = new Map(gltf.animations.map((c) => [c.name, c]));
        let skinned = false;
        gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
        if (!skinned) throw new Error(`${def.url} has no skinned mesh`);
        for (const n of CLIPS) {
          if (!clips.has(n)) warnOnce(`${id}:${n}`, `${id}: clip "${n}" missing in ${def.url}`);
        }
        const asset = { gltf, clips };
        loaded.set(id, asset);
        failed.delete(id);
        return asset;
      }).catch((err) => {
        failed.set(id, err);
        warnOnce(`${id}:load`, `couldn't load ${id} (${def.url}):`, err && err.message ? err.message : err);
        throw err;
      });
    },

    ready(id) { return loaded.has(id); },
    error(id) { return failed.get(id) || null; },

    create(id, opts) {
      const asset = loaded.get(id);
      if (!asset) throw new Error(`character "${id}" isn't loaded`);
      return new Character(id, defs[id], asset, opts);
    },

    CONTACT,

    // Where the tool's head is `time` seconds into `clip` (default: its contact frame),
    // relative to the character's root: [x (its left), y (up), z (ahead)] in model units
    // (scale 1), or null. Posed once on a hidden copy and remembered.
    reachOf(id, clip, time = CONTACT[clip], tool) {
      const asset = loaded.get(id);
      if (!asset || !asset.clips.has(clip) || time == null) return null;
      tool = tool || defs[id].tool;
      const key = `${id}|${clip}|${time.toFixed(3)}|${tool}`;
      if (reaches.has(key)) return reaches.get(key);
      let c = scratch.get(id);
      if (!c) scratch.set(id, (c = new Character(id, defs[id], asset, { tool })));
      c.setTool(tool);
      c.mixer.stopAllAction();
      const a = c.actions[clip];
      a.reset().setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.setEffectiveWeight(1);
      a.play();
      c.mixer.setTime(Math.min(time, asset.clips.get(clip).duration));
      c.root.updateMatrixWorld(true);
      const p = c.toolHead();
      const r = p ? [p.x, p.y, p.z] : null;
      reaches.set(key, r);
      return r;
    },

    Character,
  };
})();
