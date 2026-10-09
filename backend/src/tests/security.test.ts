import { assertPublicUrl, isPrivateAddress } from "../utils/safeFetch";
import { extractFromHtml, titleFromUrl } from "../services/product/productResolver";

describe("SSRF guard", () => {
  test.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "%s is private",
    (ip) => expect(isPrivateAddress(ip)).toBe(true)
  );
  test.each(["8.8.8.8", "172.32.0.1", "151.101.1.69", "2606:4700::6810:85e5"])("%s is public", (ip) => expect(isPrivateAddress(ip)).toBe(false));

  test.each([
    "http://localhost:4000/api/health",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "http://user:pass@example.com/",
    "http://8.8.8.8:2375/",
  ])("rejects %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });
});

describe("product page extraction", () => {
  test("reads JSON-LD Product inside @graph and prefixes the brand", () => {
    const html = `<html><head><script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Quencher H2.0 Tumbler","brand":{"name":"Stanley"},"description":"40 oz","image":["/img/q.jpg"]}]}</script></head></html>`;
    const p = extractFromHtml(html, "https://shop.example.com/p/1");
    expect(p.title).toBe("Stanley Quencher H2.0 Tumbler");
    expect(p.imageUrl).toBe("https://shop.example.com/img/q.jpg");
    expect(p.description).toBe("40 oz");
  });

  test("reads Amazon title, hi-res image and bullets", () => {
    const html = `<span id="productTitle"> Nova Trail Runner X1 </span><img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/abc.jpg"><div id="feature-bullets"><ul><li>Mesh upper</li><li>Orange sole</li></ul></div>`;
    const p = extractFromHtml(html, "https://www.amazon.com/dp/B000");
    expect(p.title).toBe("Nova Trail Runner X1");
    expect(p.imageUrl).toBe("https://m.media-amazon.com/images/I/abc.jpg");
    expect(p.description).toContain("Mesh upper");
  });

  test.each([
    ["https://www.nike.com/t/air-jordan-1-mid-shoes-SQf7DM", "Air Jordan 1 Mid Shoes"],
    ["https://www.stanley1913.com/products/adventure-quencher-travel-tumbler-40-oz", "Adventure Quencher Travel Tumbler 40 Oz"],
    ["https://shop.example.com/p/oversized-graphic-tee.html?variant=123", "Oversized Graphic Tee"],
    ["https://www.amazon.com/CeraVe-Moisturizing-Cream/dp/B00TTD9BRC", "CeraVe Moisturizing Cream"],
  ])("derives a product name from the link %s", (url, title) => expect(titleFromUrl(url)).toBe(title));

  test("falls back to Open Graph tags", () => {
    const html = `<meta property="og:title" content="Graphic Tee"><meta property="og:image" content="//cdn.example.com/tee.png"><meta name="description" content="Oversized fit">`;
    const p = extractFromHtml(html, "https://brand.example.com/tee");
    expect(p).toEqual({ title: "Graphic Tee", description: "Oversized fit", imageUrl: "https://cdn.example.com/tee.png" });
  });
});
