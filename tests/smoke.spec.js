import { test, expect } from "@playwright/test";

test("首页能正常加载并包含开篇文字", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "记录与亲爱的姥姥姥爷相处的点滴，永远怀念！" })
  ).toBeVisible();
});

test("时间轴渲染，点击照片可打开/关闭查看器", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".year");
  const first = page.locator(".photo").first();
  await expect(first).toBeVisible();

  await first.click();
  await expect(page.locator("#lightbox")).toBeVisible();
  await expect(page.locator("#lightboxImg")).toHaveAttribute("src", /assets\/photos\//);

  await page.click("[data-close='1']");
  await expect(page.locator("#lightbox")).toBeHidden();
});

test("移动端不应出现明显横向滚动条", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".year");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});


