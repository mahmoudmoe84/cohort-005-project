import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown.server";
import { markdown } from "~/lib/text";

// renderMarkdown is for trusted content (lesson bodies, sales copy). Untrusted
// comments go through renderComment in comment-markdown.server.ts instead.

describe("renderMarkdown", () => {
  it("renders headings and paragraphs", async () => {
    const html = await renderMarkdown(markdown("# Title\n\nSome **bold** text."));

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Some <strong>bold</strong> text.</p>");
  });

  it("highlights a code block in a loaded language", async () => {
    const html = await renderMarkdown(markdown("```ts\nconst x: number = 1;\n```"));

    expect(html).toContain('class="shiki github-dark"');
    expect(html).toContain("const");
  });

  it("highlights a code block with no language as plain text", async () => {
    const html = await renderMarkdown(markdown("```\nplain words\n```"));

    expect(html).toContain('class="shiki github-dark"');
    expect(html).toContain("plain words");
  });

  it("falls back to an escaped <pre><code> for a language that isn't loaded", async () => {
    const html = await renderMarkdown(markdown("```cobol\nIF A < B & C > D\n```"));

    expect(html).not.toContain("shiki");
    expect(html).toContain(
      "<pre><code>IF A &lt; B &amp; C &gt; D</code></pre>"
    );
  });

  it("lets raw HTML through, because lesson content is trusted", async () => {
    const html = await renderMarkdown(markdown('<div class="callout">Note</div>'));

    expect(html).toContain('<div class="callout">Note</div>');
  });
});
