import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewerAvatar } from "../../apps/web/src/components.js";

describe("reviewer avatar", () => {
  it("renders a privacy-preserving profile image with initials behind it", () => {
    const markup = renderToStaticMarkup(
      createElement(ReviewerAvatar, {
        reviewer: {
          name: "Alex Morgan",
          providerIdentity: "alex-morgan",
          avatarUrl: "https://avatars.githubusercontent.com/u/101?v=4"
        }
      })
    );

    expect(markup).toContain("Alex Morgan profile image");
    expect(markup).toContain("https://avatars.githubusercontent.com/u/101?v=4");
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain(">AM</span>");
  });

  it("uses initials when no image is available", () => {
    const markup = renderToStaticMarkup(
      createElement(ReviewerAvatar, {
        reviewer: { name: "Taylor Brooks", providerIdentity: "taylor-brooks" }
      })
    );

    expect(markup).not.toContain("<img");
    expect(markup).toContain(">TB</span>");
  });
});
