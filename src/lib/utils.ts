export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
