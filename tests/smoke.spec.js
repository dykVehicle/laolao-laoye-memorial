import { test, expect } from "@playwright/test";

test("首页能正常加载并包含开篇文字", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "记录与亲爱的姥姥姥爷相处的点滴，永远怀念！" })
  ).toBeVisible();
});

test("时间轴渲染，点击照片/视频可打开/关闭查看器", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".year");
  const first = page.locator(".photo").first();
  await expect(first).toBeVisible();

  await first.click();
  await expect(page.locator("#lightbox")).toBeVisible();

  const isVideo = await first.evaluate((el) => el.classList.contains("photo--video"));
  if (isVideo) {
    const v = page.locator("#lightboxVideo");
    await expect(v).toBeVisible();
    // video.src 的 JS 属性会被浏览器解析成绝对 URL，因此这里用 attribute 来做正则匹配更稳
    await expect(v).toHaveAttribute("src", /assets\/videos\//);
  } else {
    const img = page.locator("#lightboxImg");
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", /assets\/photos\//);
  }

  // 关闭：按 ESC（避免图片/视频层拦截点击导致用例不稳定）
  await page.keyboard.press("Escape");
  await expect(page.locator("#lightbox")).toBeHidden();
});

test("移动端不应出现明显横向滚动条", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".year");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});


