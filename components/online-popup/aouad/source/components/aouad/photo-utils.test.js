import { describe, expect, it } from "vitest";
import { scaledPhotoSize } from "./photo-utils";

describe("uploaded photo dimensions", () => {
  it("caps the longest edge at 240px while keeping the source ratio", () => {
    expect(scaledPhotoSize(400, 800)).toEqual({ width: 120, height: 240 });
    expect(scaledPhotoSize(800, 400)).toEqual({ width: 240, height: 120 });
    expect(scaledPhotoSize(120, 80)).toEqual({ width: 120, height: 80 });
  });
});
