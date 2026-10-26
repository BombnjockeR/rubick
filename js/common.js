// Shared constants for the screen (laptop) and controller (phone).
// Both pages talk over a WebRTC data channel set up by PeerJS.
// The PeerJS cloud broker is only used to introduce the two devices;
// once connected, input flows directly phone -> laptop.

window.RUBICK = {
  // Room code N maps to PeerJS id PREFIX + N. Bump the version if the
  // message format changes so old controllers can't join new screens.
  PREFIX: 'rubick-v1-',
  CODE_LENGTH: 4,
  CODE_CHARS: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // no I / O, they look like 1 / 0
  MAX_PLAYERS: 8,

  // Button bitmask, Xbox naming.
  BTN: {
    A: 1 << 0, B: 1 << 1, X: 1 << 2, Y: 1 << 3,
    LB: 1 << 4, RB: 1 << 5, VIEW: 1 << 6, MENU: 1 << 7,
    UP: 1 << 8, DOWN: 1 << 9, LEFT: 1 << 10, RIGHT: 1 << 11,
  },

  // Add ?peer=host:port to the URL to use your own PeerJS server instead
  // of the free public one (handy for local testing or self-hosting).
  peerServer: new URLSearchParams(location.search).get('peer') || '',
  get peerOptions() {
    const opts = { debug: 1 };
    if (this.peerServer) {
      const [host, port] = this.peerServer.split(':');
      const local = /^(localhost|127\.|10\.|192\.168\.)/.test(host);
      Object.assign(opts, { host, port: Number(port) || 443, path: '/', secure: !local });
    }
    return opts;
  },

  // ---- Relay (TURN) servers ----
  // Same Wi-Fi: devices connect directly. Across the internet, many networks
  // (especially mobile carriers using CGNAT) block direct links, so traffic
  // has to go through a relay. We fetch short-lived relay credentials from
  // Metered (ports 80/443 over UDP, TCP and TLS, so it gets through strict
  // firewalls). WebRTC still prefers a direct link and only relays when it
  // must. If the fetch fails we fall back to PeerJS's built-in servers.
  // Paste your Metered credentials URL here, e.g.
  //   'https://<your-app>.metered.live/api/v1/turn/credentials?apiKey=<key>'
  // Empty = use PeerJS's built-in servers (fine on the same Wi-Fi).
  TURN_URL: '',
  // Add ?relay=1 to any page to force the relay (to test it on one Wi-Fi).
  forceRelay: new URLSearchParams(location.search).get('relay') === '1',
  _ice: null,

  iceServers() {
    if (this._ice) return this._ice;
    if (!this.TURN_URL) return Promise.resolve(null);
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 4000);
    this._ice = fetch(this.TURN_URL, ctl ? { signal: ctl.signal } : {})
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((list) => {
        if (!Array.isArray(list) || !list.length) throw new Error('empty');
        return [{ urls: 'stun:stun.l.google.com:19302' }, ...list];
      })
      .catch((err) => {
        console.warn('[rubick] relay credentials unavailable, using defaults:', err.message);
        this._ice = null; // try again next time
        return null;
      })
      .finally(() => clearTimeout(timer));
    return this._ice;
  },

  // Peer options with relay servers filled in. Use this when creating a Peer.
  async peerOptionsAsync() {
    const opts = this.peerOptions;
    const ice = await this.iceServers();
    if (ice) {
      opts.config = { iceServers: ice };
      if (this.forceRelay) opts.config.iceTransportPolicy = 'relay';
    }
    return opts;
  },

  normalizeCode(raw) {
    return String(raw || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, this.CODE_LENGTH);
  },

  makeCode() {
    const bytes = new Uint8Array(this.CODE_LENGTH);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => this.CODE_CHARS[b % this.CODE_CHARS.length]).join('');
  },
};

// Screen-side game registry. Each file in js/games/ registers one game:
//   RubickGames.register({ id, name, blurb, create(hub) -> instance })
// An instance can implement any of:
//   start(), stop(), join(p), leave(p), press(p, bits), update(dt),
//   draw(ctx, timeMs), resize(), meta(p) -> roster text, hint(p) -> phone text
window.RubickGames = {
  list: [],
  register(game) { this.list.push(game); },
  get(id) { return this.list.find((g) => g.id === id); },
};
