import { TextDecoder } from "node:util";

class StrictJsonSyntaxError extends Error {}

class StrictJsonReader {
  #index = 0;

  constructor(private readonly text: string) {}

  parse(): unknown {
    this.#skipWhitespace();
    const value = this.#readValue();
    this.#skipWhitespace();
    if (this.#index !== this.text.length) throw new StrictJsonSyntaxError();
    return value;
  }

  #readValue(): unknown {
    const character = this.text[this.#index];
    if (character === "{") return this.#readObject();
    if (character === "[") return this.#readArray();
    if (character === '"') return this.#readString();
    if (character === "t") return this.#readKeyword("true", true);
    if (character === "f") return this.#readKeyword("false", false);
    if (character === "n") return this.#readKeyword("null", null);
    if (character === "-" || this.#isDigit(character))
      return this.#readNumber();
    throw new StrictJsonSyntaxError();
  }

  #readObject(): Record<string, unknown> {
    this.#index += 1;
    const output: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    const keys = new Set<string>();
    this.#skipWhitespace();
    if (this.text[this.#index] === "}") {
      this.#index += 1;
      return output;
    }
    while (this.#index < this.text.length) {
      if (this.text[this.#index] !== '"') throw new StrictJsonSyntaxError();
      const key = this.#readString();
      if (keys.has(key)) throw new StrictJsonSyntaxError();
      keys.add(key);
      this.#skipWhitespace();
      if (this.text[this.#index] !== ":") throw new StrictJsonSyntaxError();
      this.#index += 1;
      this.#skipWhitespace();
      output[key] = this.#readValue();
      this.#skipWhitespace();
      const separator = this.text[this.#index];
      if (separator === "}") {
        this.#index += 1;
        return output;
      }
      if (separator !== ",") throw new StrictJsonSyntaxError();
      this.#index += 1;
      this.#skipWhitespace();
    }
    throw new StrictJsonSyntaxError();
  }

  #readArray(): unknown[] {
    this.#index += 1;
    const output: unknown[] = [];
    this.#skipWhitespace();
    if (this.text[this.#index] === "]") {
      this.#index += 1;
      return output;
    }
    while (this.#index < this.text.length) {
      output.push(this.#readValue());
      this.#skipWhitespace();
      const separator = this.text[this.#index];
      if (separator === "]") {
        this.#index += 1;
        return output;
      }
      if (separator !== ",") throw new StrictJsonSyntaxError();
      this.#index += 1;
      this.#skipWhitespace();
    }
    throw new StrictJsonSyntaxError();
  }

  #readString(): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.text.length) {
      const character = this.text[this.#index];
      if (character === '"') {
        this.#index += 1;
        const raw = this.text.slice(start, this.#index);
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed !== "string") throw new StrictJsonSyntaxError();
        return parsed;
      }
      if (character === "\\") {
        this.#index += 2;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        throw new StrictJsonSyntaxError();
      }
      this.#index += 1;
    }
    throw new StrictJsonSyntaxError();
  }

  #readKeyword(keyword: string, value: unknown): unknown {
    if (
      this.text.slice(this.#index, this.#index + keyword.length) !== keyword
    ) {
      throw new StrictJsonSyntaxError();
    }
    this.#index += keyword.length;
    return value;
  }

  #readNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.#index),
    );
    if (match === null) throw new StrictJsonSyntaxError();
    this.#index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new StrictJsonSyntaxError();
    return value;
  }

  #skipWhitespace(): void {
    while (
      this.text[this.#index] === " " ||
      this.text[this.#index] === "\n" ||
      this.text[this.#index] === "\r" ||
      this.text[this.#index] === "\t"
    ) {
      this.#index += 1;
    }
  }

  #isDigit(value: string | undefined): boolean {
    return value !== undefined && value >= "0" && value <= "9";
  }
}

export function parseStrictJsonBytes(
  value: unknown,
  maximumBytes: number,
): unknown {
  if (!(value instanceof Uint8Array) || value.byteLength > maximumBytes) {
    throw new StrictJsonSyntaxError();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new StrictJsonSyntaxError();
  }
  if (text.charCodeAt(0) === 0xfeff) throw new StrictJsonSyntaxError();
  try {
    return new StrictJsonReader(text).parse();
  } catch {
    throw new StrictJsonSyntaxError();
  }
}
