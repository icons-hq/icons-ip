/* 도서관 — 서가 탈출 씬 (Phaser 4 · ADR-0027).
   **규칙은 `lib/zones/engine-library.js` 가 갖는다.** 이 파일은 그 규칙을 화면에 올릴 뿐이고,
   수치를 여기서 새로 정하지 않는다 — 관문(`npm run test:library-engine`)이 엔진↔회색 상자를 잠근다.
   회색 상자 `/prototypes/aouad-library-run-graybox.html` 2부의 이관본이다(iframe 임베드가 아니라 씬).

   **그림은 있으면 쓰고 없으면 네모로 떨어진다**(§ART). P4 에셋이 한 장씩 들어오는 동안에도
   게임은 계속 돌아가야 하기 때문이다. 그림이 규칙을 바꾸는 일은 없다 — 물리 상자는 그대로 두고
   그 위에 얹기만 한다(관문이 확인한다). */

import {
  CONFIG, TRAPS, LEVEL, SEGMENT_NAMES,
  segmentOf, escaped as isEscaped, missions, boostV, lungeBox, hordeSpeed, freshRun,
} from "../../lib/zones/engine-library";

export const VIEW = { w: 960, h: 360 };

/* ── §ART. 그림 ──
   `ART_DIR` 에 파일이 있으면 그 자리에 얹고, 없으면 지금까지처럼 네모를 그린다.
   **그림은 규칙을 모른다** — 물리 상자(위치·크기)는 엔진이 정한 그대로고 여기서 손대지 않는다. */
const ART_DIR = "/ip-popups/aouad/library";
const ART = {
  bgStacks: "bg-stacks.png",          // 구간 1 서가 통로 (가로 반복)
  bgReading: "bg-reading.png",        // 구간 2 열람실   (가로 반복)
  bgStairwell: "bg-stairwell.png",    // 구간 3 비상계단 벽 (가로 반복)
  floorHall: "tile-floor-hall.png",   // 구간 1·2 바닥 (학교 장판)
  floorConcrete: "tile-floor-concrete.png",   // 구간 3 바닥
  shelfStanding: "obj-shelf-standing.png",    // 서 있는 책장
  shelfFallen: "obj-shelf-fallen.png",        // 넘어진 책장 — 넘어간다
  deskTop: "obj-desk-top.png",                // 열람실 책상 상판 = 발판
  stairStep: "obj-stair-step.png",            // 계단 한 칸
  bookPile: "obj-book-pile.png",              // 책 더미 — 뛰어 넘는다
  bookCart: "obj-book-cart.png",              // 굴러오는 북카트
  shelfDoor: "obj-shelf-door.png",            // 미는 책장 = 비밀 서고 문
  doorLocked: "obj-door-locked.png",          // 잠긴 비상구 = 가짜 출구
  windowExit: "obj-window-exit.png",          // 깨진 창 = 진짜 출구
  bookmark: "obj-bookmark.png",               // 주워 모으는 책갈피
};
const FLOOR_RATIO = 4;   // 바닥 타일은 가로로 긴 띠로 쓴다 — 정사각 원본을 40px 에 통째로 밀어 넣으면 무늬가 뭉갠다
const BG_TINT = 0x8f939c;

/* ── §MOTION. 움직이는 것 ──
   격자 시트(`60_tools/make-spritesheet.py` 산출) + 프레임 표(옆의 .json 과 같은 값). skin() 과 같은 규율 —
   시트가 없으면 네모가 그대로 남는다. **그림은 규칙을 모른다** — 어느 동작을 보일지는 엔진 상태에서 읽고, 시트는 보이기만 한다.
   `faces` = 시트가 바라보는 쪽. 반대로 움직이면 뒤집는다. 인물은 칸 높이의 약 90% 를 차지한다(브리프 §8). */
const MOTION_DIR = "/ip-popups/aouad/library/motion";
const MOTION = {
  runner:    { file: "runner",     cell: [176, 256], faces: "right", acts: { run: [0, 7, 10, -1], jump: [8, 11, 0, 0], slide: [16, 18, 8, 0], caught: [24, 27, 15, 0] } },
  zombie:    { file: "zombie",     cell: [176, 256], faces: "left",  acts: { walk: [0, 5, 6, -1], alert: [8, 11, 8, 0], charge: [16, 21, 12, -1] } },
  hand:      { file: "hand",       cell: [128, 128], faces: "right", acts: { idle: [0, 3, 4, -1] } },
  lungeLow:  { file: "lunge-low",  cell: [208, 160], faces: "left",  acts: { idle: [0, 5, 12, -1] } },
  lungeLeap: { file: "lunge-leap", cell: [176, 320], faces: "right", acts: { idle: [0, 5, 12, -1] } },
  horde:     { file: "horde",      cell: [340, 480], faces: "right", acts: { idle: [0, 7, 6, -1], surge: [8, 15, 12, -1] } },
};   // acts: [첫 프레임, 끝 프레임, fps, repeat(-1=고리)]   // 배경을 한 단 낮춘다 — 사진이 밝으면 그 위에서 움직이는 것이 안 보인다

const CUE = {
  low: "뒤에서 낮게 달려온다 — 뛴다",
  leap: "뒤에서 덮쳐 온다 — 미끄러진다",
  surge: "우르르 — 뒤에서 몰려온다",
};
const CAUGHT_BY = {
  patrol: "좀비에게 잡혔다", charge: "달려든 좀비에게 잡혔다", hand: "책 사이 손에 잡혔다",
  cart: "북카트에 치였다", shelf: "서가에 깔렸다", horde: "무리에 휩쓸렸다",
  lungelow: "낮게 온 놈에게 걸렸다 — 뛰었어야 했다", lungeleap: "덮친 놈에게 잡혔다 — 미끄러졌어야 했다",
  fall: "책상 사이로 떨어졌다",
};

export function createLibraryRun({ Phaser, parent, trap = "normal", onState, onFinish, onLog, onReady }) {
  const T = TRAPS[trap] || TRAPS.normal;
  const W = VIEW.w, H = VIEW.h;
  let run = freshRun();
  let sceneReady = false;
  const say = (text, kind) => onLog && onLog({ text, kind });

  class LibraryScene extends Phaser.Scene {
    /* 그림은 있는 것만 받는다 — 없는 파일은 조용히 넘어가고 네모로 떨어진다 */
    preload() {
      this.load.on("loaderror", () => {});
      for (const [key, file] of Object.entries(ART)) this.load.image(key, `${ART_DIR}/${file}`);
      for (const [key, m] of Object.entries(MOTION)) this.load.spritesheet(key, `${MOTION_DIR}/${m.file}.png`, { frameWidth: m.cell[0], frameHeight: m.cell[1] });
    }

    has(key) { return this.textures.exists(key); }

    /* 정사각 원본을 띠 비율로 가운데만 잘라 새 그림으로 만든다.
       통째로 줄이면 배경 한 장이 360px 밖에 안 돼 한 화면에 세 번 반복되고 이음새가 그대로 드러난다 */
    cropWide(key, ratio) {
      const src = this.textures.get(key).getSourceImage();
      const h = Math.round(src.width / ratio);
      if (h >= src.height) return key;
      const out = `${key}~${ratio}`;
      if (!this.textures.exists(out)) {
        const c = this.textures.createCanvas(out, src.width, h);
        c.context.drawImage(src, 0, Math.round((src.height - h) / 2), src.width, h, 0, 0, src.width, h);
        c.refresh();
      }
      return out;
    }

    /* 회색 네모 자리에 그림을 얹는다 — **물리 상자는 손대지 않는다.** 네모는 숨기고 그림만 바꿔 끼운다.
       `w` 나 `h` 중 준 것에 맞추고 나머지 한 변은 원본 비율을 따른다(억지로 늘이면 사진이 눌린다).
       `anchor` 는 상자의 어느 변에 붙일지 — 발판은 윗면이, 바닥에 놓인 것은 아랫변이 기준이다.
       그림이 없으면 아무것도 하지 않는다(회색 네모가 그대로 남는다). */
    skin(rect, key, { w = null, h = null, anchor = "center", depth = -1 } = {}) {
      if (!rect || !this.has(key)) return null;
      const src = this.textures.get(key).getSourceImage();
      const ar = src.width / src.height;
      const dh = h !== null ? h : (w !== null ? w / ar : rect.height);
      const dw = w !== null ? w : dh * ar;
      const img = this.add.image(rect.x, rect.y, key).setDisplaySize(Math.round(dw), Math.round(dh)).setDepth(depth);
      if (anchor === "bottom") img.y = rect.y + rect.height / 2 - dh / 2;
      if (anchor === "top") img.y = rect.y - rect.height / 2 + dh / 2;
      rect.setVisible(false);
      return img;
    }

    /* 움직이는 것 — 네모 자리에 스프라이트를 세운다. 발끝(origin 0.5,1)을 네모 아랫변 가운데에.
       `h` = 인물 키(게임 px). 인물이 칸의 90% 라 칸 높이 = h/0.9. `fill` 이면 칸을 다 채우는 그림(무리). */
    rig(rect, key, { h, fill = false, depth = 1, originX = 0.5 } = {}) {
      if (!rect || !this.has(key)) return null;
      const m = MOTION[key];
      const sp = this.add.sprite(rect.x, rect.y + rect.height / 2, key, m.acts[Object.keys(m.acts)[0]][0]).setOrigin(originX, 1).setDepth(depth);
      sp.setScale((fill ? h : h / 0.9) / m.cell[1]);
      sp.rigKey = key; sp.faces = m.faces;
      rect.setVisible(false); rect.rig = sp;
      return sp;
    }

    /* 동작 하나를 보여 준다 — 같은 동작이 이미 돌고 있으면 건드리지 않는다(매 프레임 불러도 안전) */
    play(sp, act) {
      if (!sp) return;
      const name = `${sp.rigKey}:${act}`;
      if (sp.anims.currentAnim && sp.anims.currentAnim.key === name && sp.anims.isPlaying) return;
      sp.play(name);
    }

    /* 바라보는 쪽 — 시트가 보는 쪽과 움직이는 쪽이 다르면 뒤집는다 */
    face(sp, dir) {
      if (!sp || !dir) return;
      sp.setFlipX((sp.faces === "right") !== (dir > 0));
    }

    /* 몸통을 따라간다 — 물리 뒤(postupdate)에 불려서 한 프레임도 안 늦는다 */
    follow(rect) {
      const sp = rect && rect.rig;
      if (!sp) return;
      sp.x = rect.x + (sp.originX === 1 ? rect.width / 2 : 0);
      sp.y = rect.y + rect.height / 2;
    }

    /* 소품 한 장 — 원본 비율을 지킨 채 높이만 맞춘다 */
    artImage(key, x, y, h) {
      const src = this.textures.get(key).getSourceImage();
      return this.add.image(x, y, key).setDisplaySize(Math.round(h * src.width / src.height), h);
    }

    /* 좌우로 뒤집은 복사본을 옆에 붙여 두 배 폭 그림을 만든다.
       이렇게 하면 **왼쪽 끝 화소와 오른쪽 끝 화소가 같아져** 몇 번을 이어 붙여도 이음새가 없다 —
       생성 모델에 「좌우가 이어지게」를 주문해서 받아 내는 것보다 확실하다(2026-09-04 발주분은 끝을
       어둡게 떨어뜨려 화면마다 검은 세로 띠가 생겼다). 값은 좌우 대칭이 한 번씩 보이는 것뿐이고,
       서가·창·벽처럼 결이 반복되는 배경에서는 눈에 띄지 않는다. */
    mirrored(key) {
      const src = this.textures.get(key).getSourceImage();
      const out = `${key}~m`;
      if (!this.textures.exists(out)) {
        const c = this.textures.createCanvas(out, src.width * 2, src.height);
        const ctx = c.context;
        ctx.drawImage(src, 0, 0);
        ctx.save();
        ctx.translate(src.width * 2, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(src, 0, 0);
        ctx.restore();
        c.refresh();
      }
      return out;
    }

    /* 가로로 반복하는 띠 하나 — 원본 비율 그대로 띠 높이에 맞춘다. 그림이 없으면 아무것도 안 만든다 */
    band(key, x, y, w, h, depth) {
      if (!this.has(key)) return null;
      const isBg = key.startsWith("bg");
      const useKey = isBg ? this.mirrored(this.cropWide(key, VIEW.w / h)) : this.cropWide(key, FLOOR_RATIO);
      const src = this.textures.get(useKey).getSourceImage();
      const t = this.add.tileSprite(x, y, w, h, useKey).setOrigin(0, 0).setDepth(depth);
      t.tileScaleX = t.tileScaleY = h / src.height;
      return t;
    }

    create() {
      this.physics.world.setBounds(0, -400, CONFIG.world + 400, H + 400);
      this.physics.world.gravity.y = CONFIG.gravity;
      this.cameras.main.setBounds(0, 0, CONFIG.world + 200, H);
      this.solids = this.physics.add.staticGroup();
      this.hazards = this.physics.add.group({ allowGravity: false, immovable: true });
      this.addSolid = (x, y, w, h, color = 0x2a2a33) => {
        const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, color);
        this.solids.add(r); r.body.updateFromGameObject(); return r;
      };
      this.hz = (x, y, w, h, color, kind, alpha = 1) => {
        const r = this.add.rectangle(x, y, w, h, color, alpha);
        this.hazards.add(r); r.body.setAllowGravity(false); r.body.setImmovable(true); r.kind = kind; return r;
      };
      // 배경 3구간 — 맨 뒤. 그림이 없는 구간은 그냥 검정으로 남는다
      const segEnd = [CONFIG.segments[1], CONFIG.segments[2], CONFIG.world + 200];
      ["bgStacks", "bgReading", "bgStairwell"].forEach((key, i) => {
        const b = this.band(key, CONFIG.segments[i], 0, segEnd[i] - CONFIG.segments[i], H, -20);
        if (b) b.setTint(BG_TINT);
      });
      // 바닥 (열람실은 책상 사이 틈이 있다)
      const groundRects = [this.addSolid(0, CONFIG.ground, 3700, 40)];
      let gx = 3700;
      for (const g of LEVEL.gaps) { groundRects.push(this.addSolid(gx, CONFIG.ground, g.x - gx, 40)); gx = g.x + g.w; }
      groundRects.push(this.addSolid(gx, CONFIG.ground, 8200 - gx, 40));
      /* 바닥 그림 — 물리는 위에서 이미 만들었고 여기는 보이는 것만 덮는다.
         틈(gaps)은 덮지 않는다. 떨어지는 자리가 바닥처럼 보이면 안 된다 */
      let fx = 0;
      for (const g of [...LEVEL.gaps, { x: 8200, w: 0 }]) {
        this.band("floorHall", fx, CONFIG.ground, g.x - fx, 40, -5);
        fx = g.x + g.w;
      }
      this.band("floorConcrete", 8200, CONFIG.ground, CONFIG.world + 200 - 8200, 40, -5);
      /* 바닥 그림이 깔렸으면 회색 네모는 물러난다 — 안 그러면 그림 위를 그대로 덮는다(물리는 그대로) */
      if (this.has("floorHall")) groundRects.forEach((r) => r.setVisible(false));
      /* 발판·소품 그림 — 폭은 상자에 맞추고 높이는 원본 비율대로 흐른다.
         책상 상판·계단은 **윗면**이 밟는 자리라 위에 붙이고, 아래로 흐르는 만큼은 그냥 보이는 두께다 */
      for (const d of LEVEL.desks) this.skin(this.addSolid(d.x, d.y, d.w, 14, 0x3a3a44), "deskTop", { w: d.w, anchor: "top" });
      for (const t of LEVEL.stairs) this.skin(this.addSolid(t.x, t.y, t.w, 40, 0x3a3a44), "stairStep", { w: t.w, anchor: "top" });
      this.skin(this.addSolid(10900, 140, 300, 40, 0x3a3a44), "stairStep", { w: 300, anchor: "top" });   // 창 앞 마루
      for (const p of LEVEL.piles) this.skin(this.addSolid(p.x, p.y - 40, 40, 40, 0x4a3a2a), "bookPile", { h: 40, anchor: "bottom" });
      /* 출구 창 — 판정은 `CONFIG.exit` 이 하고 이 네모는 보이기만 한다. 창은 위로 길어서 마루 위에 세운다 */
      this.skin(this.add.rectangle(CONFIG.exit.x + 80, 90, 60, 90, 0x1c2a3a).setStrokeStyle(2, 0x6a8fb5),
             "windowExit", { h: 135, anchor: "bottom" });
      this.add.text(CONFIG.exit.x + 60, 30, "창", { fontSize: 12, color: "#6a8fb5" });
      // 서가 윗길(항상) + 밑 통로의 문(민다)
      this.addSolid(LEVEL.secret.topsX, LEVEL.secret.topsY, LEVEL.secret.topsW, 14, 0x5a4a2a);
      this.makeSecretDoor = () => {
        this.secretDoor = this.addSolid(LEVEL.secret.doorX, LEVEL.secret.topsY + 14, 60, CONFIG.ground - LEVEL.secret.topsY - 14, 0x5a4a2a);
        this.secretArt = this.skin(this.secretDoor, "shelfDoor", { w: 60, anchor: "bottom" });
      };
      this.dropSecretDoor = () => {
        if (this.secretDoor) this.secretDoor.destroy();
        if (this.secretArt) this.secretArt.destroy();
        this.secretDoor = null; this.secretArt = null;
      };
      this.makeSecretDoor();
      this.secretOpen = false;
      CONFIG.segments.forEach((x, i) => {
        this.add.rectangle(x, 0, 2, H, 0x23232b).setOrigin(0, 0);
        this.add.text(x + 6, 6, SEGMENT_NAMES[i], { fontSize: 12, color: "#55555f" });
      });
      // 움직이는 것 — 동작 등록(시트가 있는 것만)
      for (const [key, m] of Object.entries(MOTION)) {
        if (!this.has(key)) continue;
        for (const [act, [a, b, fps, rep]] of Object.entries(m.acts)) {
          this.anims.create({ key: `${key}:${act}`, frames: this.anims.generateFrameNumbers(key, { start: a, end: b }), frameRate: fps, repeat: rep });
        }
      }
      // 플레이어
      this.player = this.add.rectangle(120, CONFIG.ground - 28, 24, 56, 0xe8e8ee);
      this.physics.add.existing(this.player);
      this.physics.add.collider(this.player, this.solids);
      this.rig(this.player, "runner", { h: 56, depth: 2 });
      // 앞에서 오는 위협
      this.patrols = LEVEL.patrols.map((p) => {
        const z = this.hz(p.a, CONFIG.ground - 30, 30, 60, 0x8b3a3a, "patrol");
        z.a = p.a; z.b = p.b; z.dir = 1;
        this.play(this.rig(z, "zombie", { h: 60 }), "walk");
        return z;
      });
      this.shelf = this.add.rectangle(LEVEL.shelf.x, CONFIG.ground - 100, 40, 200, 0x5a4a2a);
      /* 서 있는 동안만 그림을 쓴다 — 넘어진 책장 그림은 아직 없어서 그때는 네모로 돌아간다.
         그림이 있으면 네모는 숨긴다(둘이 겹쳐 보이면 안 된다) */
      /* 그림은 원본 비율대로 높이 200 에 맞춘다 — 물리 상자(40×200)에 억지로 맞추면 책장이 납작해진다 */
      this.shelfArt = this.has("shelfStanding") ? this.artImage("shelfStanding", LEVEL.shelf.x, CONFIG.ground - 100, 200) : null;
      if (this.shelfArt) this.shelf.setVisible(false);
      this.shelfState = "stand"; this.shelfHz = null; this.shelfBlock = null; this.fallenArt = null;
      this.charge = this.hz(LEVEL.charge.x, CONFIG.ground - 30, 30, 60, 0xa04040, "charge"); this.chargeState = "idle";
      this.rig(this.charge, "zombie", { h: 60 });
      if (T.hand) { this.hand = this.hz(LEVEL.hand.x, LEVEL.hand.y, 30, 28, 0x8b3a3a, "hand"); this.play(this.rig(this.hand, "hand", { h: 28, originX: 0 }), "idle"); }
      this.cart = null; this.cartState = "idle";
      if (T.fakeDoor) {
        this.fake = this.add.rectangle(CONFIG.fakeDoor, 160, 30, 80, 0x1c2a3a).setStrokeStyle(2, 0xd8574a);
        this.fakeArt = this.skin(this.fake, "doorLocked", { h: 80 });
        this.add.text(CONFIG.fakeDoor - 16, 120, "비상구", { fontSize: 11, color: "#d8574a" });
        this.fakeHit = false;
      }
      // 뒤에서 오는 위협 — 무리(늘 있다) · 기습(한 마리씩)
      this.horde = this.hz(-999, H / 2, 60, H, 0x7a2e2e, "horde", 0.8);
      /* 무리는 앞면(오른쪽 변)이 기준이다 — 그림의 오른쪽 끝을 네모 오른쪽 변에 붙이고 왼쪽으로 뻗는다 */
      this.play(this.rig(this.horde, "horde", { h: H, fill: true, depth: 3, originX: 1 }), "idle");
      this.lunger = null; this.lungeIdx = 0; this.surgeIdx = 0; this.surgeAt = -1e9; this.cueUntil = 0; this.cue = "";
      // 책갈피
      this.marks = this.physics.add.group({ allowGravity: false, immovable: true });
      this.markObjs = LEVEL.bookmarks.map((b, i) => {
        const m = this.add.rectangle(b.x, b.y, 14, 20, 0xe0913a);
        this.marks.add(m); m.body.setAllowGravity(false); m.idx = i;
        m.art = this.skin(m, "bookmark", { h: 20 });   // 그림이 있으면 네모는 물러난다
        return m;
      });
      this.physics.add.overlap(this.player, this.marks, (_, m) => {
        if (!m.active) return;
        m.setActive(false).setVisible(false); m.body.enable = false;
        if (m.art) m.art.setVisible(false);
        run.bookmarks += 1; say(`책갈피 ${run.bookmarks}/${LEVEL.bookmarks.length}`, "good"); this.emit(true);
      });
      this.physics.add.overlap(this.player, this.hazards, (_, h) => this.caught(h.kind));
      // 입력 — 탭 = 뛴다 · 연속 두 번 = 멀리 뛴다 · 아래로 쓸기 = 미끄러진다
      this.pressAt = null; this.bufAt = -1e9; this.lastGround = -1e9; this.slideUntil = 0; this.stunUntil = 0;
      this.jumpAt = -1e9; this.jumpY = 0; this.taps = 0; this.blockedSince = null;
      this.input.on("pointerdown", (p) => { this.pressAt = this.playTime; this.pressY = p.y; this.press(); });
      this.input.on("pointerup", () => { this.pressAt = null; });
      this.input.on("pointermove", (p) => { if (this.pressAt !== null && p.y - this.pressY > 30) { this.pressAt = null; this.slide(); } });
      this.keys = this.input.keyboard.addKeys("LEFT,RIGHT,A,D");
      this.input.keyboard.on("keydown", (e) => {
        const jumpKey = ["Space", "ArrowUp", "KeyW"].includes(e.code);
        const slideKey = ["ArrowDown", "KeyS"].includes(e.code);
        /* 기본 동작은 **자동 반복까지** 막는다 — 스페이스·↓ 의 기본 동작이 페이지 스크롤이라, 꾹 누르면 존 바닥까지
           내려가 스냅이 다음 화면(굿즈샵)으로 보냈다(PM 2026-09-09 「스페이스바를 길게 누르면」). 게임이 안 돌 때는 살려 둔다 */
        if ((jumpKey || slideKey) && this.alive && e.preventDefault) e.preventDefault();
        if (e.repeat) return;                                   // 꾹 누른 자동 반복은 두 번 누른 게 아니다
        if (jumpKey) this.press();
        if (slideKey) this.slide();
      });
      this.cameras.main.startFollow(this.player, true, 1, 1, -W * 0.06, 0);   // 뒤가 보여야 한다 — 화면 44% 지점
      this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => this.syncRigs());
      this.msg = this.add.text(12, H - 26, "", { fontSize: 13, color: "#e0913a" }).setScrollFactor(0).setDepth(8);
      this.flash = this.add.rectangle(0, 0, W, H, 0x000000, 0).setOrigin(0).setScrollFactor(0).setDepth(9);
      this.playTime = 0; this.startedAt = 0; this.dying = false; this.alive = false; this.lastEmit = 0;
      /* 개발 중 결정론 재생용 손잡이 — 루프를 멈추고 game.step 을 1/60초씩 돌려 규칙을 실측한다.
         이 게임은 눈으로만 보면 놓친다(2026-09-04 회색 상자에서 버그 4건이 이 방식으로만 잡혔다). */
      if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") Object.assign(window, { __libScene: this, __libCfg: CONFIG, __libLevel: LEVEL, __libTrap: T });
      this.emit(true);
      sceneReady = true;
      onReady?.();
    }

    /* 그림이 몸통을 따라가고, 엔진 상태에서 동작을 읽는다. 물리가 끝난 뒤(postupdate)에 돈다.
       판단은 여기서 하지 않는다 — 이미 정해진 상태(속도·땅·미끄러짐·잡힘)를 **보여 줄 뿐**이다 */
    syncRigs() {
      const p = this.player, sp = p.rig;
      this.follow(p);
      if (sp) {
        const b = p.body, now = this.playTime;
        if (this.dying) this.play(sp, "caught");
        else if (!b.blocked.down) {                                  // 공중 — 시간이 아니라 세로 속도로 고른다
          sp.anims.stop();
          sp.setFrame(b.velocity.y < -120 ? 9 : b.velocity.y > 120 ? 11 : 10);
        }
        else if (now < this.slideUntil) this.play(sp, "slide");
        else if (b.velocity.x === 0) { sp.anims.stop(); sp.setFrame(8); }   // 멈춤·막힘 — 버티는 자세
        else this.play(sp, "run");
        this.face(sp, b.velocity.x || 1);
      }
      for (const z of this.patrols) { this.follow(z); this.face(z.rig, z.dir); }
      this.follow(this.charge);
      if (this.charge.rig) {
        if (this.chargeState === "idle") { this.charge.rig.anims.stop(); this.charge.rig.setFrame(8); }
        else if (this.chargeState === "warn") this.play(this.charge.rig, "alert");
        else if (this.chargeState === "run") this.play(this.charge.rig, "charge");
        this.charge.rig.setVisible(this.chargeState !== "gone");
        this.charge.setVisible(false);              // reset() 이 네모를 다시 켠다 — 그림이 있으면 네모는 늘 숨긴다
      }
      if (this.hand) this.follow(this.hand);
      if (this.lunger) { this.follow(this.lunger); this.face(this.lunger.rig, 1); }
      this.follow(this.horde);
      if (this.horde.rig) this.play(this.horde.rig, this.surging ? "surge" : "idle");
    }

    /* 한 번 = 뛴다(버퍼로 땅에 닿는 즉시) · doubleMs 안의 두 번째 = 멀리 뛴다 */
    press() {
      const b = this.player.body, now = this.playTime;
      if (!this.alive) return;
      if (this.taps === 1 && (now - this.jumpAt) < CONFIG.doubleMs && b.velocity.y < 0) {
        b.setVelocityY(-boostV(this.jumpY - this.player.y)); this.taps = 2; return;
      }
      this.bufAt = now;
    }

    begin() {

      /* 게임 키의 브라우저 기본 동작을 **DOM 리스너에서 동기로** 막는다(Phaser 캡처). 핸들러 안의 preventDefault 는
         Phaser 가 이벤트를 큐로 넘겨 다음 스텝에 부를 수 있어 늦다 — 꾹 누른 스페이스가 페이지를 내려 다음 화면으로
         넘어갔다(PM 2026-09-09). 끝나면(finish) 풀어서 페이지 스크롤을 돌려준다 */
      this.input.keyboard.addCapture(["SPACE", "UP", "DOWN", "W", "S"]);
      run = freshRun(); this.alive = true; this.dying = false;
      this.flash.fillAlpha = 0;
      this.markObjs.forEach((m) => {
        m.setActive(true).setVisible(!m.art); m.body.enable = true;
        if (m.art) m.art.setVisible(true);
      });
      this.resetShelf(); this.closeSecret(); this.reset(0);
      this.startedAt = this.playTime; this.emit(true);
    }

    resetShelf() {
       this.shelfState = "stand";
      this.shelf.setAngle(0).setPosition(LEVEL.shelf.x, CONFIG.ground - 100).setSize(40, 200).setVisible(!this.shelfArt);
      if (this.shelfArt) this.shelfArt.setAngle(0).setPosition(LEVEL.shelf.x, CONFIG.ground - 100).setVisible(true);
      if (this.fallenArt) this.fallenArt.setVisible(false);   // 다시 세웠으니 넘어진 그림은 물러난다
      if (this.shelfHz) { this.shelfHz.destroy(); this.shelfHz = null; }
      if (this.shelfBlock) { this.shelfBlock.destroy(); this.shelfBlock = null; }
    }

    closeSecret() {

      if (!this.secretOpen) return;
      this.secretOpen = false;
      this.makeSecretDoor();
    }

    reset(seg) {
      const at = CONFIG.segments[seg] + 120;
      run.seg = seg;
      this.player.setSize(24, 56); this.player.body.setSize(24, 56);
      this.player.setPosition(at, CONFIG.ground - 28);
      this.player.body.setVelocity(0, 0); this.player.body.setAllowGravity(true);
      if (seg === 0) { this.resetShelf(); this.patrols.forEach((z) => { z.dir = 1; z.body.reset(z.a, CONFIG.ground - 30); }); }
      this.chargeState = "idle";
      this.charge.setPosition(LEVEL.charge.x, CONFIG.ground - 30).setActive(true).setVisible(!this.charge.rig).setFillStyle(0xa04040);
      this.charge.body.enable = true; this.charge.body.reset(LEVEL.charge.x, CONFIG.ground - 30);
      if (this.cart) { this.cart.destroy(); this.cart = null; }
      if (this.cartArt) { this.cartArt.destroy(); this.cartArt = null; }
      this.cartState = "idle";
      if (this.lunger) { if (this.lunger.rig) this.lunger.rig.destroy(); this.lunger.destroy(); this.lunger = null; }
      this.horde.body.reset(at - T.gap0, H / 2); this.horde.setFillStyle(0x7a2e2e);
      this.surgeAt = -1e9; this.cueUntil = 0;
      this.surgeIdx = LEVEL.surges.findIndex((x) => x > at); if (this.surgeIdx < 0) this.surgeIdx = LEVEL.surges.length;
      this.lungeIdx = LEVEL.lungers.findIndex((l) => l.at > at); if (this.lungeIdx < 0) this.lungeIdx = LEVEL.lungers.length;
      this.taps = 0; this.jumpAt = -1e9; this.bufAt = -1e9;
      this.fakeHit = false; this.stunUntil = 0; this.slideUntil = 0; this.blockedSince = null; this.msg.setText("");
    }

    /* 무리에서 한 마리가 튀어나온다 */
    spawnLunge(kind) {
      const box = lungeBox(kind);
      this.lunger = this.hz(this.player.x - T.lungeBehind, box.y, box.w, box.h, kind === "low" ? 0x9a4030 : 0xb0503a, `lunge${kind}`);
      this.lunger.kindName = kind; this.lunger.body.setVelocityX(CONFIG.lungeSpeed);
      this.play(this.rig(this.lunger, kind === "low" ? "lungeLow" : "lungeLeap", { h: box.h }), "idle");
      this.cue = CUE[kind]; this.cueUntil = this.playTime + 2200; say(this.cue, "bad");
    }

    slide() {
      const p = this.player;
      if (!this.alive || this.dying || !p.body.blocked.down || this.playTime < this.slideUntil) return;
      // 문 앞에서 아래로 쓸면 민다 — 비밀 통로
      const d = LEVEL.secret.doorX - (p.x + 12);
      if (!this.secretOpen && d < 40 && d > -10) {
        this.secretOpen = true; this.dropSecretDoor();
        say("서가를 밀었다 — 밑으로 통로가 열린다", "good"); return;
      }
      this.slideUntil = this.playTime + CONFIG.slideMs;
      p.setSize(24, 28); p.body.setSize(24, 28); p.y += 14;
    }

    caught(kind) {

      if (!this.alive || this.dying) return;
      this.dying = true; run.hits += 1; this.deadAt = this.playTime;
      this.player.body.setVelocity(0, 0); this.player.body.setAllowGravity(false);
      this.flash.fillAlpha = 0.85;
      say(`${CAUGHT_BY[kind] || "잡혔다"} — ${SEGMENT_NAMES[run.seg]} 입구부터`, "bad");
      this.emit(true);
    }

    ledgeAhead() {   // 발 앞의 낮은 턱인가 (그 위로는 비어 있어야 한다)
      const p = this.player, feet = p.y + p.height / 2, x = p.x + 13;
      const low = this.physics.overlapRect(x, feet - CONFIG.vaultMax, 8, CONFIG.vaultMax, false, true).length > 0;
      const high = this.physics.overlapRect(x, feet - 70, 8, 70 - CONFIG.vaultMax, false, true).length > 0;
      return low && !high;
    }

    finish() {

      this.input.keyboard.removeCapture(["SPACE", "UP", "DOWN", "W", "S"]);   // 게임이 끝났으니 페이지 스크롤을 돌려준다
      run.escaped = true; this.alive = false; this.player.body.setVelocity(0, 0);
      run.ms = Math.round(this.playTime - this.startedAt);
      const m = missions(run);
      say(`탈출 — ${(run.ms / 1000).toFixed(1)}초 · 책갈피 ${run.bookmarks}/5 · 잡힘 ${run.hits}`, "good");
      this.emit(true);
      onFinish?.({ escaped: true, bookmarks: run.bookmarks, noHit: m.noHit, secret: run.secret, ms: run.ms, dodged: run.dodged });
    }

    emit(force) {
      const now = this.playTime;
      if (!force && now - this.lastEmit < 100) return;              // 화면 갱신은 0.1초에 한 번이면 족하다
      this.lastEmit = now;
      this.lastState = {
        alive: this.alive, dying: this.dying, seg: run.seg, bookmarks: run.bookmarks, dodged: run.dodged,
        hits: run.hits, secret: run.secret, escaped: run.escaped,
        ms: this.alive || run.escaped ? Math.round(now - this.startedAt) : run.ms,
        gap: this.alive ? Math.max(0, Math.round(this.player.x - this.horde.x)) : null,
        missions: missions(run),
      };
      onState?.(this.lastState);   // 마지막 상태를 씬에도 남긴다 — 결정론 재생이 읽는다
    }

    update(_time, delta) {
      // Scene pause stops physics and this clock together. Modal/hidden-tab time
      // must not advance traps, a pending jump, or the completion record.
      this.playTime += delta;
      const p = this.player, b = p.body, now = this.playTime;
      if (!this.alive) return;
      if (this.dying) {   // 잡힘 — 암전 뒤 구간 입구부터
        if (now - this.deadAt >= CONFIG.deathMs) { this.flash.fillAlpha = 0; b.setAllowGravity(true); this.reset(run.seg); this.dying = false; }
        else { b.setVelocity(0, 0); this.flash.fillAlpha = 0.85 * (1 - (now - this.deadAt) / CONFIG.deathMs); }
        return;
      }
      // 달리기 · 조작
      const stunned = now < this.stunUntil;
      let vx = stunned ? 0 : CONFIG.run;
      if (CONFIG.ctrl === "arrows") {
        vx = 0;
        if (this.keys.RIGHT.isDown || this.keys.D.isDown) vx = CONFIG.run;
        if (this.keys.LEFT.isDown || this.keys.A.isDown) vx = -CONFIG.run;
        if (stunned) vx = 0;
      }
      b.setVelocityX(vx);
      if (b.blocked.down) this.lastGround = now;
      const canJump = (now - this.lastGround) < CONFIG.coyoteMs && now >= this.slideUntil;
      if (canJump && (now - this.bufAt) < CONFIG.bufMs) { b.setVelocityY(-CONFIG.jumpV); this.bufAt = -1e9; this.jumpAt = now; this.jumpY = p.y; this.taps = 1; }
      if (now >= this.slideUntil && p.height !== 56) { p.setSize(24, 56); b.setSize(24, 56); p.y -= 14; }
      if (b.blocked.right && b.blocked.down && !stunned && vx > 0) {
        if (this.ledgeAhead()) { b.setVelocityY(-CONFIG.jumpV * CONFIG.vaultV); this.taps = 0; }
        else {
          if (this.blockedSince === null) this.blockedSince = now;
          if (now - this.blockedSince > 700) {
            this.msg.setText(run.seg === 1 && !this.secretOpen && Math.abs(LEVEL.secret.doorX - p.x) < 60
              ? "막혔다 — 두 번 눌러 넘거나, 아래로 쓸어 민다" : "막혔다 — 뛴다 (높으면 두 번)");
          }
        }
      } else this.blockedSince = null;
      if (p.y > H + 40) { this.caught("fall"); return; }
      // 순찰 — 움직임은 전부 물리 속도(좌표를 직접 옮기면 물리가 한 번 더 옮긴다)
      for (const z of this.patrols) {
        if (z.x > z.b) z.dir = -1;
        if (z.x < z.a) z.dir = 1;
        z.body.setVelocityX(z.dir * CONFIG.patrolSpeed);
      }
      // 서가 붕괴 — 예고 → 눕는 동안 통과하면 잡힘 → 턱
      if (this.shelfState === "stand" && p.x > LEVEL.shelf.trigger) {
        this.shelfState = "wobble"; this.shelfAt = now; this.msg.setText("서가가 흔들린다…");
        this.tweens.add({ targets: [this.shelf, this.shelfArt].filter(Boolean), angle: { from: -4, to: 4 }, duration: 90, yoyo: true, repeat: Math.floor(T.shelfWarn * 1000 / 180) });
      }
      if (this.shelfState === "wobble" && now - this.shelfAt > T.shelfWarn * 1000) {
        this.shelfState = "fall"; this.shelfAt = now; this.msg.setText("");
        if (this.shelfArt) this.shelfArt.setVisible(false);
        this.shelf.setAngle(0).setPosition(LEVEL.shelf.x + 100, CONFIG.ground - 30).setSize(220, 60);
        this.shelf.setVisible(!this.has("shelfFallen"));
        if (!this.fallenArt) this.fallenArt = this.skin(this.shelf, "shelfFallen", { w: 220, anchor: "bottom" });
        if (this.fallenArt) this.fallenArt.setPosition(LEVEL.shelf.x + 100, CONFIG.ground - this.fallenArt.displayHeight / 2).setVisible(true);
        this.shelfHz = this.hz(LEVEL.shelf.x + 100, CONFIG.ground - 30, 220, 60, 0x8b3a3a, "shelf", 0.35);
      }
      if (this.shelfState === "fall" && now - this.shelfAt > 400) {
        this.shelfState = "down"; this.shelfHz.destroy(); this.shelfHz = null;
        this.shelfBlock = this.addSolid(LEVEL.shelf.x - 10, CONFIG.ground - 60, 220, 60, 0x5a4a2a);
        this.shelfBlock.setVisible(!this.fallenArt);   // 넘어진 책장 그림이 이미 그 자리에 있다
        this.shelf.setVisible(false);
      }
      // 돌진 좀비 — 감지 → 예고 → 달려든다
      if (this.chargeState === "idle" && LEVEL.charge.x - p.x < LEVEL.charge.detect && p.x < LEVEL.charge.x) {
        this.chargeState = "warn"; this.chargeAt = now; this.charge.setFillStyle(0xe0913a); this.msg.setText("…!");
      }
      if (this.chargeState === "warn" && now - this.chargeAt > T.chargeWarn * 1000) {
        this.chargeState = "run"; this.charge.setFillStyle(0xd8574a); this.charge.body.setVelocityX(-CONFIG.chargeSpeed); this.msg.setText("");
      }
      if (this.chargeState === "run" && this.charge.x < p.x - 400) {
        this.charge.setActive(false).setVisible(false); this.charge.body.enable = false; this.chargeState = "gone";
      }
      // 북카트 — 소리 예고 뒤 오른쪽에서 굴러온다
      if (this.cartState === "idle" && p.x > LEVEL.cart.trigger && p.x < LEVEL.cart.trigger + 400) {
        this.cartState = "warn"; this.cartAt = now; this.msg.setText("…덜컹, 덜컹");
      }
      if (this.cartState === "warn" && now - this.cartAt > T.cartWarn * 1000) {
        this.cartState = "roll"; this.msg.setText("");
        this.cart = this.hz(this.cameras.main.scrollX + W + 60, CONFIG.ground - 30, 70, 60, 0x8b3a3a, "cart");
        this.cartArt = this.skin(this.cart, "bookCart", { h: 60, anchor: "bottom" });
        this.cart.body.setVelocityX(-CONFIG.cartSpeed);
      }
      if (this.cartArt && this.cart) this.cartArt.x = this.cart.x;     // 그림이 몸통을 따라간다(물리는 몸통만 안다)
      if (this.cartState === "roll" && this.cart && this.cart.x < this.cameras.main.scrollX - 100) {
        this.cart.destroy(); this.cart = null;
        if (this.cartArt) { this.cartArt.destroy(); this.cartArt = null; }
        this.cartState = "gone";
      }
      // 비밀 통로 통과 — 서가 밑 통로 한가운데를 지나야 한다(윗길로 달리면 아니다)
      if (this.secretOpen && !run.secret && p.x > LEVEL.secret.doorX + 200 && p.x < LEVEL.secret.exitX - 50 && p.y > LEVEL.secret.topsY + 40) {
        run.secret = true; say("비밀 서고를 지났다", "good"); this.emit(true);
      }
      // ── 뒤에서 오는 위험 ──
      if (LEVEL.surges[this.surgeIdx] !== undefined && p.x > LEVEL.surges[this.surgeIdx]) { this.surgeIdx++; this.surgeAt = now; }
      const inWarn = now - this.surgeAt < CONFIG.surgeWarn;
      const surging = !inWarn && now - this.surgeAt < CONFIG.surgeWarn + T.surgeFor;
      this.horde.body.setVelocityX(hordeSpeed(trap, p.x - this.horde.x, surging));
      this.horde.setFillStyle(surging ? 0xb03030 : inWarn ? 0x8f3232 : 0x7a2e2e);
      this.surging = surging;
      if (!this.lunger && LEVEL.lungers[this.lungeIdx] && p.x > LEVEL.lungers[this.lungeIdx].at) this.spawnLunge(LEVEL.lungers[this.lungeIdx++].kind);
      if (this.lunger && this.lunger.x > p.x + CONFIG.lungeClear) {
        run.dodged += 1;
        say(`${this.lunger.kindName === "low" ? "낮게 온 놈" : "덮친 놈"}을 흘렸다`, "good");
        if (this.lunger.rig) this.lunger.rig.destroy();
        this.lunger.destroy(); this.lunger = null;
      }
      // 뒤쪽 신호가 앞쪽 신호보다 급하다
      if (now < this.cueUntil) this.msg.setText(this.cue);
      else if (inWarn || surging) this.msg.setText(CUE.surge);
      else if (this.msg.text === CUE.surge || this.msg.text === this.cue) this.msg.setText("");
      // 가짜 비상구 — 잠겨 있다, 0.5초 멈칫
      if (this.fake && !this.fakeHit && Math.abs(p.x - CONFIG.fakeDoor) < 20 && p.y < 200) {
        this.fakeHit = true; this.stunUntil = now + CONFIG.stunMs;
        this.msg.setText("잠겼다! (뒤가 온다)"); say("비상구가 잠겨 있다 — 창으로", "bad");
      }
      if (isEscaped(p.x, p.y)) { this.finish(); return; }
      const seg = segmentOf(p.x);
      if (seg > run.seg) { run.seg = seg; say(`체크포인트 — ${SEGMENT_NAMES[seg]}`); }
      this.emit(false);
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO, parent, width: W, height: H, backgroundColor: "#0d0d11",
    physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
    scene: LibraryScene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    input: { activePointers: 2, keyboard: { target: parent, capture: [] } },
  });
  return {
    game,
    start: () => { const sc = game.scene.scenes[0]; if (sceneReady && sc?.sys.isActive()) sc.begin(); },
    setPaused: (paused) => {
      const sc = game.scene.scenes[0];
      if (!sceneReady || !sc) return;
      sc.input.enabled = !paused;
      sc.input.keyboard.enabled = !paused;
      if (paused) {
        sc.pressAt = null; sc.input.keyboard.resetKeys();
        if (sc.sys.isActive()) sc.sys.pause();
      } else if (sc.sys.isPaused()) sc.sys.resume();
    },
    destroy: () => { sceneReady = false; game.destroy(true); },
  };
}
