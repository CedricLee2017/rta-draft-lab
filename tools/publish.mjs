#!/usr/bin/env node
/**
 * 一鍵上傳到 GitHub：
 *   npm run publish -- "這次改了什麼"
 *
 * - git add -A
 * - 有變更才 commit（沒變更就只 push）
 * - push 到目前分支（預設 main）
 *
 * push 後 Cloudflare Pages 會自動 build web/ 並部署線上網站。
 */
import { execFileSync } from "node:child_process";

const REPO_URL = "https://github.com/CedricLee2017/rta-draft-lab";
const SITE_URL = "https://rta-draft-lab.pages.dev";

const message =
  process.argv.slice(2).join(" ").trim() ||
  `更新 ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

function run(args) {
  execFileSync("git", args, { stdio: "inherit" });
}

function output(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const branch = output(["branch", "--show-current"]) || "main";

run(["add", "-A"]);
const staged = output(["diff", "--cached", "--name-only"]);

if (staged) {
  console.log("將提交：");
  console.log(staged);
  run(["commit", "-m", message]);
} else {
  console.log("沒有新的變更，直接檢查遠端…");
}

run(["push", "origin", branch]);

console.log(`\nGitHub：${REPO_URL}/tree/${branch}`);
console.log(`最新 ZIP：${REPO_URL}/archive/refs/heads/${branch}.zip`);
console.log(`線上網站：${SITE_URL}`);
console.log("Cloudflare Pages 會在 push 後自動 build（約 1–3 分鐘）。");
