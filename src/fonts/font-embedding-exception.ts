/**
 * A font the host asked to embed that cannot be embedded. Mirrors PHP
 * `Fonts\FontEmbeddingException`.
 *
 * Thrown rather than skipped. A deck that silently leaves out a font it was
 * asked to carry renders in a substitute face on every machine without it, which
 * is the exact failure embedding exists to prevent, and nothing would say so.
 */
export class FontEmbeddingException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FontEmbeddingException";
    Object.setPrototypeOf(this, FontEmbeddingException.prototype);
  }
}
