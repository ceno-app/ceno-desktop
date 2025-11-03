/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * This tests the SearchService to check our override of the remote settings is
 * working as expected.
 */

"use strict";

const expectedURLs = {
  ddg: "https://duckduckgo.com/?q=test",
  startpage: "https://www.startpage.com/sp/search?q=test",
};
const defaultEngine = "ddg";

add_setup(async function setup() {
  await Services.search.init();
});

add_task(async function test_listEngines() {
  const { engines } =
    await Services.search.wrappedJSObject._fetchEngineSelectorEngines();
  const foundIdentifiers = engines.map(e => e.identifier);
  Assert.deepEqual(foundIdentifiers, Object.keys(expectedURLs));
});

add_task(async function test_default() {
  Assert.equal(
    (await Services.search.getDefault()).id,
    defaultEngine,
    `${defaultEngine} is our default search engine in normal mode.`
  );
  Assert.equal(
    (await Services.search.getDefaultPrivate()).id,
    defaultEngine,
    `${defaultEngine} is our default search engine in PBM.`
  );
});

add_task(function test_checkSearchURLs() {
  for (const [id, url] of Object.entries(expectedURLs)) {
    const engine = Services.search.getEngineById(id);
    const foundUrl = engine.getSubmission("test").uri.spec;
    Assert.equal(foundUrl, url, `The URL of ${engine.name} is not altered.`);
  }
});
