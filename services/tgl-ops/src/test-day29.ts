process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { isAllowedTool } from "./agents/aeo-execution/safety.js";
import { argsFor, editLink, pageFromAsset, placeholders, postFields, toolPayload } from "./agents/aeo-execution/implement.js";

let passed = 0;
function t(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

t("allowlist: read/create/update pages and posts; never delete, whatever the token allows", () => {
  for (const ok of ["wp_create_page", "wp_update_page", "wp_get_page", "wp_list_posts", "wp_update_post", "wp_ability_rank_math_get_post_schema", "wp_ability_core_get_site_info"]) assert.equal(isAllowedTool(ok), true, ok);
  for (const no of ["wp_delete_page", "wp_delete_post", "wp_delete_media", "wp_upload_media", "wp_update_media", "wp_ability_rank_math_set_homepage_seo", "wp_ability_wpcode_list_snippets", "wp_update_user"]) assert.equal(isAllowedTool(no), false, no);
  assert.equal(isAllowedTool("wp_update_page", { annotations: { destructiveHint: true } }), false);
});

t("page from asset: H1 → title, /slug → slug, Markdown → HTML, placeholders found", () => {
  const p = pageFromAsset({ title: "/what-is-aeo-geo-ai-visibility-india", content: { format: "markdown", body: "# What is AEO?\n\n**Short answer:** AEO is…\n\n## How is it different?\n- one\n- two\n\nResponse time: [add current figure from your records]" } });
  assert.equal(p.title, "What is AEO?");
  assert.equal(p.slug, "what-is-aeo-geo-ai-visibility-india");
  assert.match(p.html, /<strong>Short answer:<\/strong>/);
  assert.match(p.html, /<h2>How is it different\?<\/h2>/);
  assert.match(p.html, /<li>one<\/li>/);
  assert.doesNotMatch(p.html, /What is AEO\?<\/h1>/);
  assert.deepEqual(p.placeholders, ["[add current figure from your records]"]);
  const q = pageFromAsset({ title: "Industry pages template + coaching institute (Chandigarh) draft", content: { body: "Plain text, no heading" } });
  assert.equal(q.slug, undefined);
  assert.throws(() => pageFromAsset({ title: "x", content: { body: "  " } }), /no content/);
  assert.deepEqual(placeholders("[confirm: WhatsApp API] and [NEET / JEE] and [Your city]"), ["[confirm: WhatsApp API]", "[Your city]"]);
});

t("arguments mapped onto the tool's own schema; missing required ones fail loudly", () => {
  assert.deepEqual(argsFor({ properties: { post_title: {}, post_content: {}, post_status: {} }, required: ["post_title"] }, { title: "T", content: "<p>c</p>", status: "draft", slug: undefined }),
    { post_title: "T", post_content: "<p>c</p>", post_status: "draft" });
  assert.deepEqual(argsFor({ properties: { id: {}, status: {} } }, { id: 7, status: "publish" }), { id: 7, status: "publish" });
  assert.throws(() => argsFor({ properties: { page_id: {} }, required: ["page_id", "content"] }, { id: 7 }), /needs content/);
  assert.deepEqual(argsFor(undefined, { title: "T" }), { title: "T" });
});

t("tool results: structured, JSON text, nested post, errors", () => {
  assert.deepEqual(postFields(toolPayload({ content: [{ type: "text", text: '{"success":true,"page":{"ID":42,"post_status":"draft","link":"https://s.in/?page_id=42"}}' }] })), { id: 42, link: "https://s.in/?page_id=42", status: "draft", content: undefined });
  assert.equal(postFields(toolPayload({ structuredContent: { id: 9, link: { rendered: "https://s.in/x/" }, content: { raw: "hi [add x]" } } })).content, "hi [add x]");
  assert.throws(() => toolPayload({ isError: true, content: [{ type: "text", text: "Sorry, you are not allowed" }] }), /not allowed/);
  assert.equal(editLink("https://thegrowthlab.co.in/wp-json/easy-mcp-ai/v1/mcp", 42), "https://thegrowthlab.co.in/wp-admin/post.php?post=42&action=edit");
});

console.log(`\nDay 29: ${passed} checks passed`);
