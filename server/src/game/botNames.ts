const ADJECTIVES = [
  "Silent", "Swift", "Lucky", "Cosmic", "Neon", "Frosty", "Golden",
  "Shadow", "Turbo", "Wild", "Sleepy", "Angry", "Happy", "Tiny",
  "Mega", "Ultra", "Dark", "Bright", "Lazy", "Sneaky", "Brave",
];

const NOUNS = [
  "Fox", "Wolf", "Panda", "Tiger", "Hawk", "Nova", "Pixel",
  "Sphere", "Comet", "Ghost", "Ninja", "Pilot", "Drift", "Orbit",
  "Storm", "Blaze", "Frost", "Echo", "Viper", "Moth", "Bear",
];

const CYRILLIC = [
  "КотЛапой", "Пельмень", "Снежок", "Бублик", "Ракета", "Туман",
  "Вихрь", "Зефир", "Кефир", "Пингвин", "Енот", "Сова", "Жук",
  "Краб", "Лис", "Волк", "Медведь", "Сыр", "Пирог", "Чайник",
];

const SUFFIXES = ["", "42", "99", "777", "Pro", "XD", "_ru", "228"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function maybeCaps(s: string): string {
  if (Math.random() < 0.35) {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  return s;
}

/** Случайный ник до 16 символов, похожий на игрока. */
export function randomBotName(used: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    let name: string;
    const roll = Math.random();

    if (roll < 0.35) {
      const adj = pick(ADJECTIVES);
      const noun = pick(NOUNS);
      name = `${adj}${noun}${pick(SUFFIXES)}`;
    } else if (roll < 0.55) {
      name = `${pick(NOUNS)}${Math.floor(Math.random() * 9000 + 100)}`;
    } else if (roll < 0.75) {
      name = `xX_${pick(NOUNS)}_${pick(SUFFIXES) || "X"}x`;
    } else if (roll < 0.9) {
      name = pick(CYRILLIC) + (Math.random() < 0.4 ? String(Math.floor(Math.random() * 99)) : "");
    } else {
      name = `${pick(["Mr", "Dr", "The", ""])}${pick(NOUNS)}${pick(SUFFIXES)}`;
    }

    name = maybeCaps(name.replace(/__/g, "_")).slice(0, 16);
    if (name.length >= 3 && !used.has(name)) {
      used.add(name);
      return name;
    }
  }

  const fallback = `Player${Math.floor(Math.random() * 90000)}`;
  used.add(fallback);
  return fallback.slice(0, 16);
}
