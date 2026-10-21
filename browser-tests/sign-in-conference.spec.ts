import { test, expect, type Page } from "@playwright/test";
const conference = {
  published: true,
  edition: "21st",
  name: "Uttarakhand State Science & Technology Conference (USSTC)",
  shortName: "USSTC",
  theme:
    "Skill Enhancement for Science-based Knowledge Generation and Employment in Uttarakhand",
  tagline:
    "Science · Skills · Innovation · Employment · Sustainable Uttarakhand",
  startDate: "2026-10-23",
  endDate: "2026-10-24",
  venue: "Dehradun, Uttarakhand",
  organizer: "Uttarakhand State Council for Science & Technology (UCOST)",
  organizerAddress: "Vigyan Dham, Jhajra, Dehradun – 248015",
  website: "https://www.ucost.uk.gov.in",
  highlights: [
    "Keynote Sessions",
    "Expert Talks",
    "Technical Sessions",
    "Innovation & Exhibition",
    "Youth & Student Participation",
    "Collaboration for Impact",
  ],
  logos: [
    { src: "/partners/ucost.webp", label: "UCOST" },
    {
      src: "/partners/uttarakhand-government.webp",
      label: "Government of Uttarakhand",
    },
  ],
};
async function serve(page: Page, details: object) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/public/conference")
      return route.fulfill({ json: details });
    if (path === "/api/branding")
      return route.fulfill({
        json: {
          applicationName: "CONE",
          logoId: null,
          logoUrl: null,
          version: 1,
        },
      });
    return route.fulfill({
      status: 401,
      json: { error: "Sign in to continue" },
    });
  });
}

test("the sign-in screen presents the published conference", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await serve(page, conference);
  await page.goto("/");
  const art = page.locator(".login-art");
  await expect(art.locator(".login-brand")).toHaveText(
    "CONE : Conference Operations & Networking Environment",
  );
  // Organiser logos lead the panel, above the conference name.
  const logosTop = await art.locator(".conference-logos").boundingBox();
  const titleTop = await art.locator(".conference-heading").boundingBox();
  expect(logosTop!.y).toBeLessThan(titleTop!.y);
  await expect(art.getByLabel("21st edition")).toBeVisible();
  await expect(
    art.getByRole("heading", { name: conference.name }),
  ).toBeVisible();
  await expect(art.getByText(conference.theme)).toBeVisible();
  await expect(art.getByText("23 – 24 October 2026")).toBeVisible();
  await expect(art.getByText("Dehradun, Uttarakhand")).toBeVisible();
  await expect(art.locator(".conference-highlights li")).toHaveCount(6);
  await expect(art.getByRole("img", { name: "UCOST" })).toBeVisible();
  await expect(
    art.getByRole("img", { name: "Government of Uttarakhand" }),
  ).toBeVisible();
  await expect(
    art.getByRole("link", { name: "www.ucost.uk.gov.in" }),
  ).toHaveAttribute("href", "https://www.ucost.uk.gov.in");
  // Every bundled image actually loaded.
  for (const img of await art.locator("img").all())
    expect(
      await img.evaluate((el: HTMLImageElement) => el.naturalWidth),
    ).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("sign-in-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(art).toBeHidden();
  await expect(page.locator(".conference-strip")).toContainText("21st USSTC");
  await expect(page.locator(".conference-strip")).toContainText(
    "23 – 24 October 2026 · Dehradun, Uttarakhand",
  );
  await page.screenshot({ path: testInfo.outputPath("sign-in-mobile.png") });
});

for (const viewport of [
  { width: 1920, height: 875 },
  { width: 900, height: 700 },
]) {
  for (const details of [
    { label: "no highlights", highlights: [], tagline: conference.tagline },
    { label: "no highlights or tagline", highlights: [], tagline: "" },
    {
      label: "one highlight",
      highlights: conference.highlights.slice(0, 1),
      tagline: conference.tagline,
    },
  ]) {
    test(`${details.label} leaves no gap above the organiser at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await serve(page, { ...conference, ...details });
      await page.goto("/");
      const art = page.locator(".login-art");
      const organiser = art.locator(".conference-organizer");
      await expect(organiser).toBeVisible();
      await expect(art.locator(".conference-highlights li")).toHaveCount(
        details.highlights.length,
      );
      if (!details.highlights.length)
        await expect(art.locator(".conference-highlights")).toHaveCount(0);
      const preceding = await art
        .locator(details.tagline ? ".conference-tagline" : ".conference-facts")
        .boundingBox();
      const footer = await organiser.boundingBox();
      // Removing optional content must leave only the normal section spacing.
      const gap = footer!.y - (preceding!.y + preceding!.height);
      expect(gap).toBeGreaterThanOrEqual(20);
      expect(gap).toBeLessThan(30);
      await organiser.getByRole("link").scrollIntoViewIfNeeded();
      await expect(organiser.getByRole("link")).toBeInViewport();
      if (details.label === "no highlights")
        await page.screenshot({
          path: testInfo.outputPath("no-highlights.png"),
        });
    });
  }
}

test("a name that already starts with the edition is not repeated", async ({
  page,
}) => {
  await serve(page, {
    ...conference,
    name: "21st Uttarakhand State Science & Technology Congress 2026-27",
  });
  await page.goto("/");
  await expect(page.locator(".conference-heading h1")).toHaveText(
    "Uttarakhand State Science & Technology Congress 2026-27",
  );
});

test("unpublished conference details stay off the sign-in screen", async ({
  page,
}) => {
  await serve(page, { published: false });
  await page.goto("/");
  await expect(page.locator(".login-art h1")).toContainText(
    "A thoughtful space",
  );
  await expect(page.locator(".conference-showcase")).toHaveCount(0);
  await expect(page.locator(".login-brand")).toBeVisible();
});
