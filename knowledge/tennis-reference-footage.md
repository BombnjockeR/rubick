# Tennis reference footage: dives and strokes, measured

Measured 2026-10-28 frame by frame with `/skill-watch` (`--every 1`, crops tiled with ffmpeg) on `art/reference/gameplay/tennis/Nintendo switch sports_ (56) #switchsports #tennis.mp4` (the owner's local copy of the YouTube short `TQorjBl0vdU`): 12.5 s, 720×720, 29.77 fps, so 33.6 ms per frame; doubles, camera high behind the near team.

- **Dives** (far player, 6.08–6.89 s and 10.82–11.86 s): ~4 frames of running toward the ball, a push-off frame leaning toward it, then **5–8 frames in the air** (170–270 ms) flat and belly-down, head toward the ball, **racket arm stretched out ahead of the head**, legs trailing with knees bent. The body covers **2–4 body heights** in the air, about three times its running speed. Contact comes 1–4 frames after take-off. Belly landing, 2–3 frames of slide, **0.2–0.45 s lying on the court**, then a quick get-up (2–4 frames to kneeling, standing by ~2 more). Launch to standing: 0.64 s and 0.87 s.
- **What a dive returns**: when it connects, a weak pop-up that rises steeply and only just carries the net (6.25 s → over the net at ~6.95 s); a late one misses and the ball bounces twice (11.05 s, "2次落地").
- **Lunge** (near player, 4.87–5.07 s): crouched ready with the racket back, one big step toward the ball with the trail leg straight, contact low and to the side at the racket's face, follow-through over the opposite shoulder with the back leg kicked up; back to ready by ~0.3 s after contact.
- **Strokes meet the ball at the racket** in every hit seen: the ball is at the strings on the contact frame. Hits are marked by a swoosh arc and a burst at the ball; the ball has a ground shadow and a short trail; a high ball also shows a faint vertical streak.
- Not visible in this clip: a smash (the serve is overhead, with a jump at contact).

Mabar's clips (`art/clips.py` `dive`, `lunge`, `smash`) and the dive's flight, slide and time on the ground (`js/games/racket.js`) follow these numbers.
