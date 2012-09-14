/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

Cu.import("resource://services-sync/constants.js");
Cu.import("resource://services-sync/policies.js");
Cu.import("resource://services-sync/service.js");
Cu.import("resource://services-sync/status.js");
Cu.import("resource://services-sync/util.js");

function login_handling(handler) {
  return function (request, response) {
    if (basic_auth_matches(request, "johndoe", "ilovejane")) {
      handler(request, response);
    } else {
      let body = "Unauthorized";
      response.setStatusLine(request.httpVersion, 401, "Unauthorized");
      response.bodyOutputStream.write(body, body.length);
    }
  };
}

function run_test() {
  let logger = Log4Moz.repository.rootLogger;
  Log4Moz.repository.rootLogger.addAppender(new Log4Moz.DumpAppender());

  let collectionsHelper = track_collections_helper();
  let upd = collectionsHelper.with_updated_collection;
  let collections = collectionsHelper.collections;

  do_test_pending();
  let server = httpd_setup({
    "/1.1/johndoe/storage/crypto/keys": upd("crypto", new ServerWBO("keys").handler()),
    "/1.1/johndoe/storage/meta/global": upd("meta",   new ServerWBO("global").handler()),
    "/1.1/johndoe/info/collections":    login_handling(collectionsHelper.handler)
  });

  const GLOBAL_SCORE = 42;

  try {
    _("Set up test fixtures.");
    new SyncTestingInfrastructure("johndoe", "ilovejane", "foo");
    Service.scheduler.globalScore = GLOBAL_SCORE;
    // Avoid daily ping
    Svc.Prefs.set("lastPing", Math.floor(Date.now() / 1000));

    let threw = false;
    Svc.Obs.add("weave:service:sync:error", function (subject, data) {
      threw = true;
    });

    _("Initial state: We're successfully logged in.");
    Service.login();
    do_check_true(Service.isLoggedIn);
    do_check_eq(Status.login, LOGIN_SUCCEEDED);

    _("Simulate having changed the password somewhere else.");
    Service.identity.basicPassword = "ilovejosephine";

    _("Let's try to sync.");
    Service.sync();

    _("Verify that sync() threw an exception.");
    do_check_true(threw);

    _("We're no longer logged in.");
    do_check_false(Service.isLoggedIn);

    _("Sync status won't have changed yet, because we haven't tried again.");

    _("globalScore is reset upon starting a sync.");
    do_check_eq(Service.scheduler.globalScore, 0);

    _("Our next sync will fail appropriately.");
    try {
      Service.sync();
    } catch (ex) {
    }
    do_check_eq(Status.login, LOGIN_FAILED_LOGIN_REJECTED);

  } finally {
    Svc.Prefs.resetBranch("");
    server.stop(do_test_finished);
  }
}
