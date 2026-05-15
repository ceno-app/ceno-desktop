/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * This tests that we use the HTML version of DuckDuckGo when in the safest
 * security level.
 */

"use strict";

const expectedURLs = {
  ddg: "https://html.duckduckgo.com/html?q=test",
};

add_task(async function test_securityLevel() {
  await Services.search.init();
  for (const [id, url] of Object.entries(expectedURLs)) {
    const engine = Services.search.getEngineById(id);
    const foundUrl = engine.getSubmission("test").uri.spec;
    Assert.equal(foundUrl, url, `${engine.name} is in HTML mode.`);
  }
});
