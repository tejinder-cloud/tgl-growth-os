process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { checkCall, isAllowedTool } from "./agents/aeo-execution/safety.js";
import { argsFor, editLink, matchPage, metaValue, pageFromAsset, pageList, parseMetaAsset, placeholders, postFields, publishAs, toolPayload } from "./agents/aeo-execution/implement.js";

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

t("page or blog post: explainers are posts; services, industries and hubs are pages", () => {
  assert.equal(publishAs({ title: "/what-is-aeo-geo-ai-visibility-india", body: "# What is AEO and why does your business need AI visibility?\n..." }), "post");
  assert.equal(publishAs({ title: "/ai-automation-whatsapp-crm-lead-scoring", body: "# AI automation for leads: WhatsApp, CRM and lead scoring\n..." }), "page");
  assert.equal(publishAs({ title: "/case-studies hub (summary page)", body: "# Case studies: how The Growth Lab turns leads into clients" }), "page");
  assert.equal(publishAs({ title: "Industry pages template + coaching institute (Chandigarh) draft", body: "# How can a coaching institute in Chandigarh show up in ChatGPT answers?" }), "page");
  assert.equal(publishAs({ title: "/aeo-vs-seo", body: "# AEO vs SEO: a plain guide" }), "post");
});

t("meta: parse the suggestion, match pages, only Rank Math's two fields are writable", () => {
  const body = "**Homepage**\nTitle: AEO & GEO Agency in India | The Growth Lab\nDescription: Get named by ChatGPT.\n\n**What is AEO page**\nTitle: What is AEO? | The Growth Lab\nDescription: AEO explained.\n\n**AI automation page**\nTitle: AI Automation for Leads | The Growth Lab\n\n**Pricing page**\nTitle: Pricing";
  const pairs = parseMetaAsset(body);
  assert.equal(pairs.length, 4);
  assert.deepEqual(pairs[0], { label: "Homepage", title: "AEO & GEO Agency in India | The Growth Lab", description: "Get named by ChatGPT." });
  assert.equal(pairs[2].description, null);
  const pages = pageList({ pages: [
    { ID: 12, post_title: "Home", link: "https://thegrowthlab.co.in/", post_name: "home" },
    { id: 899, title: { rendered: "What is AEO (Answer Engine Optimization) and why does your business need AI visibility?" }, link: "https://thegrowthlab.co.in/what-is-aeo-geo-ai-visibility-india/", slug: "what-is-aeo-geo-ai-visibility-india" },
    { id: 901, title: "AI automation for leads: WhatsApp, CRM and lead scoring", link: "https://thegrowthlab.co.in/ai-automation-whatsapp-crm-lead-scoring/", slug: "ai-automation-whatsapp-crm-lead-scoring" },
  ] });
  const o = "https://thegrowthlab.co.in";
  assert.equal(matchPage("Homepage", pages, o)?.id, 12);
  assert.equal(matchPage("What is AEO page", pages, o)?.id, 899);
  assert.equal(matchPage("AI automation page", pages, o)?.id, 901);
  assert.equal(matchPage("Pricing page", pages, o), null);
  assert.equal(metaValue({ value: "x" }), "x"); assert.equal(metaValue([""]), ""); assert.equal(metaValue(null), null);
  assert.equal(isAllowedTool("wp_update_post_meta"), true);
  assert.equal(isAllowedTool("wp_delete_post_meta"), false);
  assert.doesNotThrow(() => checkCall("wp_update_post_meta", { key: "rank_math_title" }));
  assert.throws(() => checkCall("wp_update_post_meta", { key: "_elementor_data" }), /not allowed/);
  assert.doesNotThrow(() => checkCall("wp_update_post_meta", { meta: { rank_math_title: "x" } }));
  assert.throws(() => checkCall("wp_update_post_meta", { meta: { rank_math_title: "x", _wp_page_template: "y" } }), /_wp_page_template/);
  // The real Easy MCP AI schemas (8 Nov)
  const upd = { required: ["post_id", "meta"], properties: { meta: {}, resave: {}, post_id: {}, post_type: {} } };
  assert.deepEqual(argsFor(upd, { id: 12, meta: { rank_math_title: "T" }, post_type: "pages" }), { post_id: 12, meta: { rank_math_title: "T" }, post_type: "pages" });
  const get = { required: ["post_id"], properties: { key: {}, post_id: {}, post_type: {} } };
  assert.deepEqual(argsFor(get, { id: 12, key: "rank_math_title", post_type: "pages" }), { post_id: 12, key: "rank_math_title", post_type: "pages" });
  assert.equal(metaValue({ rank_math_title: "Old" }, "rank_math_title"), "Old");
  assert.equal(metaValue({ meta: { rank_math_title: ["Old"] } }, "rank_math_title"), "Old");
});

console.log(`\nDay 29: ${passed} checks passed`);
