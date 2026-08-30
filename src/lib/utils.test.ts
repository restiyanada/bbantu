import { describe, it, expect } from "vitest";
import { sanitizeFileName } from "./utils";

describe("sanitizeFileName", () => {
  it("passes through an already-safe filename", () => {
    expect(sanitizeFileName("proof.jpg")).toBe("proof.jpg");
  });

  it("drops any directory component", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a/b/c.png")).toBe("c.png");
    expect(sanitizeFileName("a\\b\\c.png")).toBe("c.png");
  });

  it("replaces other unsafe characters", () => {
    expect(sanitizeFileName("weird name?.png")).toBe("weird_name_.png");
  });

  it("never returns an empty string", () => {
    expect(sanitizeFileName("../")).toBe("file");
    expect(sanitizeFileName("")).toBe("file");
  });
});
