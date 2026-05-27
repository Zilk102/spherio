import {
  DEFAULT_SKIN_ID,
  GAME_DOMAIN,
  GAME_URL,
  getSkin,
  isFreeSkin,
  listSkinsForUser,
  skinShopPrice,
  type AuthResponse,
} from "@spherio/shared";
import {
  addFriend,
  authGuest,
  authLogin,
  authRegister,
  buySkin,
  createLobby,
  fetchFriends,
  fetchLeaderboard,
  fetchProfile,
  patchProfile,
} from "../api/http.js";
import { clearAuth, loadAuth, saveAuth } from "../lib/session.js";
import { joinPrivateArena, joinPublicArena } from "../net/colyseus.js";
import { syncTouchGameChrome } from "../lib/touchDevice.js";
import type { Room } from "colyseus.js";
import { Game } from "../game/Game.js";
import { SkinPreview3D } from "../game/SkinPreview3D.js";

const SKIN_KEY = "sphere3d_skin";
const SKIN_COLOR_KEY = "sphere3d_skin_color";
const NICK_KEY = "sphere3d_nick";
const LEGACY_SKIN_KEY = "spherio_skin";

function loadSkinId(): string {
  return localStorage.getItem(SKIN_KEY) ?? localStorage.getItem(LEGACY_SKIN_KEY) ?? DEFAULT_SKIN_ID;
}

function loadSkinColor(): number {
  const raw = localStorage.getItem(SKIN_COLOR_KEY);
  if (!raw) return 0xffffff;
  const n = parseInt(raw.replace(/^#/, ""), 16);
  return Number.isFinite(n) ? n & 0xffffff : 0xffffff;
}

const DRAWER_TITLES: Record<string, string> = {
  lobby: "Игра с друзьями",
  skins: "Скин сферы",
  account: "Аккаунт",
  friends: "Друзья",
  top: "Топ игроков",
};

export interface MenuCallbacks {
  onEnterGame: () => void;
  setStatus: (msg: string) => void;
}

export class MainMenu {
  private auth: AuthResponse | null = null;
  private profileEmail: string | null = null;
  private isGuest = true;
  private authTab: "login" | "register" = "login";
  private skinId = loadSkinId();
  private skinColor = loadSkinColor();
  private lobbyCode: string | null = null;
  private game: Game | null = null;
  private leavePromise: Promise<void> | null = null;
  private activeDrawer: string | null = null;
  private skinPreview3d: SkinPreview3D | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: MenuCallbacks,
  ) {
    this.bindDrawer();
    this.bindPlay();
    this.bindLobby();
    this.bindFriends();
    this.bindAuth();
    this.bindNick();
    this.bindTopTabs();
    this.applyInviteFromUrl();
    this.bindLeave();
    this.bindPause();
    this.bindSkinColor();
    this.bindSkinsDrawer();
    void this.initAuth();
  }

  private bindPause(): void {
    document.getElementById("btn-resume")?.addEventListener("click", () => {
      this.resumeFromPause();
    });
    document.getElementById("btn-exit-match")?.addEventListener("click", () => {
      if (window.confirm("Выйти из матча? Прогресс этой сессии будет потерян.")) {
        void this.leaveGame();
      }
    });
  }

  private bindSkinColor(): void {
    const input = document.getElementById("skin-color") as HTMLInputElement | null;
    input?.addEventListener("input", () => {
      const hex = input.value.replace("#", "");
      const n = parseInt(hex, 16);
      if (!Number.isFinite(n)) return;
      this.skinColor = n & 0xffffff;
      localStorage.setItem(SKIN_COLOR_KEY, String(this.skinColor));
      this.updateSkinPreview();
      this.renderSkins();
      this.syncSkinPreview3d();
    });
  }

  private bindSkinsDrawer(): void {
    document.getElementById("btn-skins-done")?.addEventListener("click", () => {
      this.closeDrawer();
    });
    document.getElementById("btn-skin-reset-view")?.addEventListener("click", () => {
      this.skinPreview3d?.resetView();
    });
  }

  private getSkinPreview3d(): SkinPreview3D {
    if (!this.skinPreview3d) {
      const canvas = document.getElementById("skin-preview-canvas") as HTMLCanvasElement | null;
      if (!canvas) throw new Error("skin-preview-canvas missing");
      this.skinPreview3d = new SkinPreview3D(canvas);
    }
    return this.skinPreview3d;
  }

  private syncSkinPreview3d(): void {
    const skin = getSkin(this.skinId);
    if (!skin) return;
    const color = this.displayColorForSkin(this.skinId);
    try {
      this.getSkinPreview3d().setSkin(this.skinId, color);
    } catch {
      /* canvas not mounted */
    }
    const title = document.getElementById("skins-preview-name");
    if (title) title.textContent = skin.name;
    const hint = document.getElementById("skins-hint");
    if (hint) {
      hint.textContent = skin.tintable
        ? "Свой цвет · зажмите и поверните"
        : "Зажмите и поверните, чтобы рассмотреть";
    }
  }

  private bindLeave(): void {
    let menuTapLock = false;
    const openPause = (e?: Event) => {
      e?.preventDefault();
      e?.stopPropagation();
      if (menuTapLock) return;
      menuTapLock = true;
      window.setTimeout(() => {
        menuTapLock = false;
      }, 400);
      this.openPauseMenu();
    };
    const btn = document.getElementById("btn-leave");
    if (!btn) return;
    const onMenuTap = (e: Event) => {
      if (e.type === "pointerdown" && (e as PointerEvent).pointerType === "mouse") return;
      openPause(e);
    };
    btn.addEventListener("click", openPause);
    btn.addEventListener("pointerdown", onMenuTap, { passive: false });
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "mouse") return;
        const t = e.target;
        if (t instanceof Element && t.closest("#btn-leave")) {
          onMenuTap(e);
        }
      },
      { capture: true, passive: false },
    );
    window.addEventListener("sphere3d:leave-game", (e: Event) => {
      const detail = (e as CustomEvent<{ restartPublic?: boolean }>).detail;
      if (detail?.restartPublic) {
        void this.restartPublicMatch();
      } else {
        void this.leaveGame();
      }
    });
  }

  private async restartPublicMatch(): Promise<void> {
    // Завершаем текущий матч и сразу запускаем новый публичный.
    await this.leaveGame();
    await this.startGame(async () =>
      joinPublicArena({
        name: this.getNick(),
        skinId: this.skinId,
        skinColor: this.joinSkinColor(),
        token: this.auth?.token,
      }),
    );
  }

  private openPauseMenu(): void {
    if (!this.game) return;
    this.closeDrawer();
    this.game.setMenuOpen(true);
    const menu = document.getElementById("in-game-menu");
    menu?.classList.remove("hidden");
    menu?.setAttribute("aria-hidden", "false");
    document.getElementById("chat-root")?.classList.add("hidden");
    document.getElementById("controls")?.classList.add("hidden");
    this.cb.setStatus("");
  }

  private resumeFromPause(): void {
    if (!this.game) return;
    this.game.setMenuOpen(false);
    const menu = document.getElementById("in-game-menu");
    menu?.classList.add("hidden");
    menu?.setAttribute("aria-hidden", "true");
    document.getElementById("chat-root")?.classList.remove("hidden");
    syncTouchGameChrome(true);
    this.cb.setStatus("");
  }

  private restoreMenuUi(): void {
    const menu = document.getElementById("in-game-menu");
    menu?.classList.add("hidden");
    menu?.setAttribute("aria-hidden", "true");
    document.getElementById("welcome")?.classList.remove("hidden");
    document.getElementById("hud")?.classList.add("hidden");
    document.getElementById("btn-leave")?.classList.add("hidden");
    document.getElementById("game-ui")?.classList.add("hidden");
    document.getElementById("chat-root")?.classList.add("hidden");
    document.getElementById("match-end")?.classList.add("hidden");
    document.body.classList.remove("in-game");
    syncTouchGameChrome(false);
  }

  private applyInviteFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code")?.trim().toUpperCase();
    if (!code || code.length < 4) return;
    const input = document.getElementById("lobby-code") as HTMLInputElement | null;
    if (input) input.value = code;
    this.lobbyCode = code;
    this.openDrawer("lobby");
    this.cb.setStatus(`Приглашение: ${code}`);
  }

  private async initAuth(): Promise<void> {
    const saved = loadAuth();
    if (saved?.auth.token) {
      try {
        const profile = await fetchProfile(saved.auth.token);
        this.auth = {
          ...saved.auth,
          userId: profile.userId,
          displayName: profile.displayName,
          equippedSkinId: profile.equippedSkinId,
          ownedSkinIds: profile.ownedSkinIds,
        };
        saveAuth(this.auth, profile.guest);
        this.isGuest = profile.guest;
        this.profileEmail = profile.email ?? null;
        if (profile.equippedSkinId) {
          this.skinId = profile.equippedSkinId;
          localStorage.setItem(SKIN_KEY, this.skinId);
        }
        this.updateUserPill(profile.guest);
        this.updateSkinPreview();
        this.renderSkins();
        this.syncNickUi();
        this.updateAccountPanel();
        return;
      } catch {
        clearAuth();
      }
    }
    try {
      this.auth = await authGuest();
      saveAuth(this.auth, true);
      this.isGuest = true;
      this.profileEmail = null;
      this.updateUserPill(true);
      this.updateSkinPreview();
      this.renderSkins();
      this.syncNickUi();
      this.updateAccountPanel();
    } catch {
      this.cb.setStatus("Сервер недоступен — запустите docker compose up");
    }
  }

  private syncNickUi(): void {
    const nickRow = document.getElementById("nick-row");
    const hint = document.getElementById("nick-account-hint");
    const hintName = document.getElementById("nick-account-name");
    const nickEl = document.getElementById("nick") as HTMLInputElement | null;
    const guest = this.isGuest;

    nickRow?.classList.toggle("hidden", !guest);
    hint?.classList.toggle("hidden", guest);
    if (!guest && this.auth) {
      if (hintName) hintName.textContent = this.auth.displayName;
      if (nickEl) nickEl.value = "";
    } else if (nickEl) {
      const saved = localStorage.getItem(NICK_KEY);
      if (saved && !nickEl.value.trim()) nickEl.value = saved;
    }
  }

  private updateUserPill(guest: boolean): void {
    const el = document.getElementById("auth-status");
    if (!el || !this.auth) return;
    el.textContent = guest
      ? `Гость · ${this.auth.displayName}`
      : this.auth.displayName;
  }

  private displayColorForSkin(skinId: string): number {
    const skin = getSkin(skinId);
    if (!skin) return this.skinColor;
    return skin.tintable ? this.skinColor : skin.defaultColor;
  }

  private joinSkinColor(): number {
    return this.displayColorForSkin(this.skinId);
  }

  private updateSkinPreview(): void {
    const skin = getSkin(this.skinId);
    const ball = document.getElementById("skin-preview-ball");
    const nameEl = document.getElementById("skin-preview-name");
    if (!skin || !ball) return;
    const c = this.displayColorForSkin(this.skinId);
    const hex = c.toString(16).padStart(6, "0");
    ball.style.setProperty("--skin-color", `#${hex}`);
    ball.style.setProperty(
      "--skin-glow",
      `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, 0.45)`,
    );
    if (skin.kind === "emoji" && skin.emoji) {
      ball.classList.add("skin-preview-ball--emoji");
      ball.textContent = skin.emoji;
    } else {
      ball.classList.remove("skin-preview-ball--emoji");
      ball.textContent = "";
    }
    if (nameEl) nameEl.textContent = skin.name;
    this.updateSkinColorPicker();
  }

  private updateSkinColorPicker(): void {
    const skin = getSkin(this.skinId);
    const row = document.getElementById("skin-color-row");
    const input = document.getElementById("skin-color") as HTMLInputElement | null;
    const swatch = row?.querySelector(".skins-color-swatch") as HTMLElement | null;
    const show = skin?.tintable ?? false;
    row?.classList.toggle("hidden", !show);
    if (input && show) {
      const c = this.skinColor & 0xffffff;
      const hex = `#${c.toString(16).padStart(6, "0")}`;
      input.value = hex;
      if (swatch) swatch.style.background = hex;
    }
  }

  private bindDrawer(): void {
    document.querySelectorAll("[data-drawer]").forEach((el) => {
      el.addEventListener("click", (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.drawer;
        if (id) this.openDrawer(id);
      });
    });

    document.querySelectorAll("[data-drawer-close]").forEach((el) => {
      el.addEventListener("click", () => this.closeDrawer());
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.activeDrawer) this.closeDrawer();
    });
  }

  private openDrawer(id: string): void {
    const drawer = document.getElementById("drawer");
    const title = document.getElementById("drawer-title");
    if (!drawer || !title) return;

    this.activeDrawer = id;
    drawer.setAttribute("aria-hidden", "false");
    title.textContent = DRAWER_TITLES[id] ?? "Меню";

    document.querySelectorAll("[data-drawer-panel]").forEach((panel) => {
      const match = (panel as HTMLElement).dataset.drawerPanel === id;
      panel.classList.toggle("hidden", !match);
    });

    if (id === "top") void this.loadLeaderboard("all");
    if (id === "friends") void this.loadFriends();
    if (id === "skins") {
      drawer.dataset.activePanel = "skins";
      this.renderSkins();
      try {
        this.getSkinPreview3d().start();
        this.syncSkinPreview3d();
      } catch {
        /* ignore */
      }
    } else {
      delete drawer.dataset.activePanel;
      this.skinPreview3d?.stop();
    }
    if (id === "account") this.updateAccountPanel();
  }

  private closeDrawer(): void {
    const drawer = document.getElementById("drawer");
    if (!drawer) return;
    this.activeDrawer = null;
    delete drawer.dataset.activePanel;
    this.skinPreview3d?.stop();
    drawer.setAttribute("aria-hidden", "true");
  }

  private bindAuth(): void {
    document.querySelectorAll("[data-auth-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        const tab = (el as HTMLElement).dataset.authTab;
        if (tab !== "login" && tab !== "register") return;
        this.authTab = tab;
        this.syncAuthTabUi();
      });
    });

    document.getElementById("auth-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (this.authTab === "register") void this.doRegister();
      else void this.doLogin();
    });

    document.getElementById("btn-guest-reset")?.addEventListener("click", () => {
      void this.doGuest();
    });

    document.getElementById("btn-save-profile")?.addEventListener("click", () => {
      void this.saveProfileNick();
    });

    document.getElementById("btn-logout")?.addEventListener("click", () => {
      clearAuth();
      this.profileEmail = null;
      void this.initAuth();
      this.authTab = "login";
      this.syncAuthTabUi();
      this.syncNickUi();
      this.cb.setStatus("Выход выполнен");
    });

    document.getElementById("auth-copy-id")?.addEventListener("click", () => {
      const id = this.auth?.userId;
      if (!id) return;
      void navigator.clipboard.writeText(id).then(
        () => this.cb.setStatus("ID скопирован"),
        () => this.cb.setStatus(id),
      );
    });

    this.syncAuthTabUi();
  }

  private bindNick(): void {
    document.getElementById("nick")?.addEventListener("change", () => {
      if (!this.isGuest) return;
      const v = (document.getElementById("nick") as HTMLInputElement)?.value.trim();
      if (v) localStorage.setItem(NICK_KEY, v);
    });
  }

  private syncAuthTabUi(): void {
    document.querySelectorAll("[data-auth-tab]").forEach((el) => {
      el.classList.toggle("active", (el as HTMLElement).dataset.authTab === this.authTab);
    });
    const submit = document.getElementById("btn-auth-submit");
    const password = document.getElementById("auth-password") as HTMLInputElement | null;
    const desc = document.getElementById("auth-form-desc");
    const nickRow = document.getElementById("auth-nick-row");
    const authNick = document.getElementById("auth-nick") as HTMLInputElement | null;
    const isRegister = this.authTab === "register";

    nickRow?.classList.toggle("hidden", !isRegister);
    if (isRegister && authNick) {
      const mainNick = (document.getElementById("nick") as HTMLInputElement)?.value.trim();
      if (mainNick && !authNick.value.trim()) authNick.value = mainNick;
      authNick.required = true;
    } else if (authNick) {
      authNick.required = false;
    }

    if (submit) {
      submit.textContent = isRegister ? "Создать аккаунт" : "Войти";
    }
    if (password) {
      password.autocomplete = isRegister ? "new-password" : "current-password";
    }
    if (desc) {
      desc.textContent = isRegister
        ? "Укажите ник — он сохранится в аккаунте и не придётся вводить каждый раз."
        : "Войдите — прогресс и скины с гостевой сессии сохранятся.";
    }
  }

  private getRegisterNick(): string {
    return (document.getElementById("auth-nick") as HTMLInputElement)?.value.trim() ?? "";
  }

  private async saveProfileNick(): Promise<void> {
    const name = (document.getElementById("profile-nick") as HTMLInputElement)?.value.trim();
    if (!name || name.length < 2) {
      this.cb.setStatus("Ник от 2 символов");
      return;
    }
    if (!this.auth?.token || this.isGuest) return;
    try {
      const profile = await patchProfile({ displayName: name }, this.auth.token);
      this.auth = {
        ...this.auth,
        displayName: profile.displayName,
        equippedSkinId: profile.equippedSkinId,
        ownedSkinIds: profile.ownedSkinIds,
      };
      saveAuth(this.auth, false);
      this.updateUserPill(false);
      this.syncNickUi();
      this.updateAccountPanel();
      this.cb.setStatus(`Ник сохранён: ${profile.displayName}`);
    } catch (e) {
      this.cb.setStatus(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }

  private updateAccountPanel(): void {
    const signedIn = document.getElementById("auth-signed-in");
    const signedOut = document.getElementById("auth-signed-out");
    const title = document.getElementById("drawer-title");
    const guest = loadAuth()?.guest ?? this.isGuest;

    signedIn?.classList.toggle("hidden", guest);
    signedOut?.classList.toggle("hidden", !guest);

    if (this.activeDrawer === "account" && title) {
      title.textContent = guest ? "Вход" : "Профиль";
    }

    if (!guest && this.auth) {
      const profileNick = document.getElementById("profile-nick") as HTMLInputElement | null;
      const emailEl = document.getElementById("auth-email-display");
      const avatar = document.getElementById("auth-avatar");
      const idBtn = document.getElementById("auth-copy-id");
      if (profileNick) profileNick.value = this.auth.displayName;
      if (emailEl) {
        emailEl.textContent = this.profileEmail ?? "Email не указан";
      }
      if (avatar) {
        const skin = getSkin(this.skinId);
        const c = this.displayColorForSkin(this.skinId);
        const hex = c.toString(16).padStart(6, "0");
        avatar.style.setProperty("--skin-color", `#${hex}`);
        avatar.style.setProperty(
          "--skin-glow",
          `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, 0.45)`,
        );
        if (skin?.kind === "emoji" && skin.emoji) {
          avatar.textContent = skin.emoji;
        } else {
          avatar.textContent = this.auth.displayName.slice(0, 1).toUpperCase();
        }
      }
      if (idBtn) {
        const short = `${this.auth.userId.slice(0, 8)}…`;
        idBtn.textContent = short;
        idBtn.title = this.auth.userId;
      }
    } else {
      this.syncAuthTabUi();
    }
  }

  private async doRegister(): Promise<void> {
    const email = (document.getElementById("auth-email") as HTMLInputElement)?.value.trim();
    const password = (document.getElementById("auth-password") as HTMLInputElement)?.value;
    const displayName = this.getRegisterNick();
    if (!email || password.length < 6) {
      this.cb.setStatus("Email и пароль (≥6 символов)");
      return;
    }
    if (displayName.length < 2) {
      this.cb.setStatus("Укажите ник (от 2 символов)");
      return;
    }
    try {
      const guestId = loadAuth()?.auth.userId;
      const pending = await authRegister({
        email,
        password,
        displayName,
        guestUserId: guestId,
      });
      this.profileEmail = email;
      this.authTab = "login";
      this.syncAuthTabUi();
      this.closeDrawer();
      this.cb.setStatus(
        `${pending.message} После подтверждения войдите с тем же email и паролем.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "email_taken") {
        this.cb.setStatus("Этот email уже зарегистрирован");
      } else if (msg === "email_not_verified" || msg === "smtp_not_configured") {
        this.cb.setStatus("Почта сервера не настроена. Напишите в поддержку.");
      } else {
        this.cb.setStatus(msg || "Ошибка регистрации");
      }
    }
  }

  private async doLogin(): Promise<void> {
    const email = (document.getElementById("auth-email") as HTMLInputElement)?.value.trim();
    const password = (document.getElementById("auth-password") as HTMLInputElement)?.value;
    if (!email || !password) {
      this.cb.setStatus("Введите email и пароль");
      return;
    }
    try {
      const guestId = loadAuth()?.auth.userId;
      this.auth = await authLogin({ email, password, guestUserId: guestId });
      saveAuth(this.auth, false);
      this.isGuest = false;
      this.profileEmail = email;
      this.skinId = this.auth.equippedSkinId || this.skinId;
      localStorage.setItem(SKIN_KEY, this.skinId);
      this.updateUserPill(false);
      this.updateSkinPreview();
      this.renderSkins();
      this.syncNickUi();
      this.updateAccountPanel();
      this.closeDrawer();
      this.cb.setStatus(`Добро пожаловать, ${this.auth.displayName}!`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "email_not_verified") {
        this.cb.setStatus("Подтвердите email по ссылке из письма (проверьте «Спам»).");
      } else {
        this.cb.setStatus("Неверный email или пароль");
      }
    }
  }

  private async doGuest(): Promise<void> {
    clearAuth();
    try {
      this.auth = await authGuest({ displayName: this.getNick() });
      saveAuth(this.auth, true);
      this.isGuest = true;
      this.profileEmail = null;
      this.updateUserPill(true);
      this.updateSkinPreview();
      this.renderSkins();
      this.syncNickUi();
      this.updateAccountPanel();
      this.cb.setStatus("Новая гостевая сессия");
    } catch {
      this.cb.setStatus("API недоступен");
    }
  }

  private bindPlay(): void {
    document.getElementById("btn-ffa")?.addEventListener("click", () => {
      void this.startGame(async () => {
        const name = this.getNick();
        return joinPublicArena({
          name,
          skinId: this.skinId,
          skinColor: this.joinSkinColor(),
          token: this.auth?.token,
        });
      });
    });
  }

  private bindTopTabs(): void {
    document.querySelectorAll(".top-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".top-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const period = (btn as HTMLElement).dataset.period as "all" | "daily";
        void this.loadLeaderboard(period);
      });
    });
  }

  private bindFriends(): void {
    document.getElementById("btn-add-friend")?.addEventListener("click", () => {
      void this.addFriendById();
    });
  }

  private async addFriendById(): Promise<void> {
    const input = document.getElementById("friend-id") as HTMLInputElement | null;
    const id = input?.value.trim();
    if (!id || !this.auth?.token) return;
    try {
      await addFriend(id, this.auth.token);
      if (input) input.value = "";
      await this.loadFriends();
      this.cb.setStatus("Друг добавлен");
    } catch {
      this.cb.setStatus("Не удалось добавить друга");
    }
  }

  private async loadFriends(): Promise<void> {
    const el = document.getElementById("friends-list");
    if (!el || !this.auth?.token) return;
    try {
      const data = await fetchFriends(this.auth.token);
      if (data.friends.length === 0) {
        el.innerHTML = "<p class=\"drawer-desc\">Список пуст</p>";
        return;
      }
      el.innerHTML = data.friends
        .map((f) => `<div class="friend-row">${f.displayName}<br><small>${f.userId.slice(0, 8)}…</small></div>`)
        .join("");
    } catch {
      el.textContent = "Войдите в аккаунт для друзей";
    }
  }

  private bindLobby(): void {
    const maxEl = document.getElementById("lobby-max") as HTMLInputElement | null;
    const maxVal = document.getElementById("lobby-max-val");
    maxEl?.addEventListener("input", () => {
      if (maxVal && maxEl) {
        maxVal.textContent = maxEl.value;
        maxEl.setAttribute("aria-valuenow", maxEl.value);
      }
    });

    document.getElementById("btn-create-lobby")?.addEventListener("click", async () => {
      try {
        const maxClients = Number(
          (document.getElementById("lobby-max") as HTMLInputElement)?.value ?? 8,
        );
        const enableBots = !!(document.getElementById("lobby-bots") as HTMLInputElement)?.checked;
        const lobby = await createLobby({ maxClients, enableBots });
        this.lobbyCode = lobby.code;
        const el = document.getElementById("lobby-created");
        if (el) {
          const url = `${GAME_URL}/?code=${lobby.code}`;
          const localUrl = `${window.location.origin}${window.location.pathname}?code=${lobby.code}`;
          el.innerHTML =
            `<strong>${lobby.code}</strong><br>` +
            `<a class="invite-link" href="${localUrl}">${GAME_DOMAIN}/?code=${lobby.code}</a>`;
          el.classList.remove("hidden");
        }
        const input = document.getElementById("lobby-code") as HTMLInputElement | null;
        if (input) input.value = lobby.code;
        this.cb.setStatus("Лобби создано — отправьте ссылку");
      } catch {
        this.cb.setStatus("Не удалось создать лобби");
      }
    });

    document.getElementById("btn-join-lobby")?.addEventListener("click", () => {
      const input = document.getElementById("lobby-code") as HTMLInputElement | null;
      const code = (input?.value ?? this.lobbyCode ?? "").trim().toUpperCase();
      if (code.length < 4) {
        this.cb.setStatus("Введите код из 4–6 символов");
        return;
      }
      void this.startGame(() =>
        joinPrivateArena({
          name: this.getNick(),
          skinId: this.skinId,
          skinColor: this.joinSkinColor(),
          code,
          token: this.auth?.token,
        }),
      );
    });
  }

  private getNick(): string {
    if (!this.isGuest && this.auth?.displayName) {
      return this.auth.displayName.slice(0, 16);
    }
    const input = document.getElementById("nick") as HTMLInputElement | null;
    const v = input?.value.trim() || localStorage.getItem(NICK_KEY)?.trim();
    return (v || "Игрок").slice(0, 16);
  }

  private async startGame(joinFn: () => Promise<Room>): Promise<void> {
    this.closeDrawer();
    if (this.leavePromise) await this.leavePromise;
    document.getElementById("match-end")?.classList.add("hidden");
    this.cb.setStatus("Подключение к арене…");
    try {
      const room = await joinFn();
      const nick = this.getNick();
      if (this.game) {
        await this.game.leave();
        this.game = null;
      }
      const game = new Game(this.canvas);
      await game.connect(room, nick);
      game.startLoop();
      this.game = game;
      this.enterGame();
      this.cb.setStatus("");
    } catch (e) {
      console.error(e);
      this.cb.setStatus("Не удалось подключиться");
    }
  }

  private enterGame(): void {
    document.getElementById("welcome")?.classList.add("hidden");
    document.getElementById("hud")?.classList.remove("hidden");
    document.getElementById("btn-leave")?.classList.remove("hidden");
    document.getElementById("game-ui")?.classList.remove("hidden");
    document.getElementById("chat-root")?.classList.remove("hidden");
    this.cb.onEnterGame();
  }

  async leaveGame(): Promise<void> {
    if (this.leavePromise) return this.leavePromise;

    this.leavePromise = (async () => {
      const game = this.game;
      this.game = null;
      this.restoreMenuUi();

      if (game) {
        try {
          await game.leave();
        } catch (err) {
          console.error("leaveGame", err);
        }
      }
      void this.initAuth();
    })();

    try {
      await this.leavePromise;
    } finally {
      this.leavePromise = null;
    }
  }

  private renderSkins(): void {
    const grid = document.getElementById("skin-grid");
    if (!grid) return;
    const owned = this.auth?.ownedSkinIds ?? [];
    const skins = listSkinsForUser(owned);
    grid.innerHTML = "";
    for (const skin of skins) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "skin-chip skin-chip--strip" + (skin.id === this.skinId ? " selected" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", String(skin.id === this.skinId));
      const chipColor = skin.tintable ? this.skinColor : skin.defaultColor;
      btn.style.setProperty(
        "--skin-color",
        `#${chipColor.toString(16).padStart(6, "0")}`,
      );
      btn.addEventListener("click", () => {
        void this.selectSkin(skin.id);
      });
      const dot = document.createElement("span");
      if (skin.kind === "emoji" && skin.emoji) {
        dot.className = "skin-emoji";
        dot.textContent = skin.emoji;
      } else {
        dot.className = "skin-dot";
      }
      btn.append(dot, document.createTextNode(skin.name));
      if (!skin.free) {
        const badge = document.createElement("span");
        badge.className = "skin-pro";
        const price = skinShopPrice(skin.id);
        badge.textContent = price != null ? `${price}🪙` : "PRO";
        btn.append(badge);
      }
      grid.append(btn);
    }
    this.updateSkinColorPicker();
    this.syncSkinPreview3d();
    const selected = grid.querySelector(".skin-chip.selected");
    selected?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  private async selectSkin(skinId: string): Promise<void> {
    const skin = getSkin(skinId);
    const owned = this.auth?.ownedSkinIds.includes(skinId) ?? false;
    if (skin && !skin.free && !owned && this.auth?.token) {
      const price = skinShopPrice(skinId);
      if (price != null) {
        try {
          const bought = await buySkin(skinId, this.auth.token);
          this.auth.ownedSkinIds = bought.ownedSkinIds;
          saveAuth(this.auth, loadAuth()?.guest ?? true);
        } catch {
          this.cb.setStatus(`Нужно ${price} монет для этого скина`);
          return;
        }
      }
    }
    this.skinId = skinId;
    localStorage.setItem(SKIN_KEY, skinId);
    if (this.auth?.token && !loadAuth()?.guest) {
      try {
        await patchProfile({ equippedSkinId: skinId }, this.auth.token);
      } catch {
        /* офлайн */
      }
    }
    this.updateSkinPreview();
    this.renderSkins();
    this.syncSkinPreview3d();
  }

  private async loadLeaderboard(period: "all" | "daily" = "all"): Promise<void> {
    const el = document.getElementById("menu-leaderboard");
    if (!el) return;
    el.textContent = "Загрузка…";
    try {
      const data = await fetchLeaderboard(period, 15);
      if (data.entries.length === 0) {
        el.innerHTML = "<p>Пока пусто — сыграйте первый матч!</p>";
        return;
      }
      el.innerHTML =
        `<strong>${period === "daily" ? "Топ сегодня" : "Лучшие игроки"}</strong>` +
        data.entries
          .map((e) => `<div class="lb-row"><span>${e.rank}</span> ${e.displayName} <em>${e.score}</em></div>`)
          .join("");
    } catch {
      el.textContent = "Топ временно недоступен";
    }
  }
}
