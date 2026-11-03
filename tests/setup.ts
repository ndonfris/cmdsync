/**
 * The commands in these tests are written for sh, so pin it: with `"shell": "auto"`
 * (the default) they would otherwise run in whatever shell started the tests.
 * Imported first by the tests that run commands; child processes inherit it.
 * Set CMDSYNC_SHELL yourself to run the tests with another shell.
 */
process.env.CMDSYNC_SHELL ??= 'sh';

/**
 * Whether cmdsync runs "in GitHub Actions" (where it prints `::error` annotations and
 * writes GITHUB_OUTPUT / GITHUB_STEP_SUMMARY) is up to each test, not to where the
 * tests run: in CI these are set, and spawned CLIs would inherit them.
 */
delete process.env.GITHUB_ACTIONS;
delete process.env.GITHUB_OUTPUT;
delete process.env.GITHUB_STEP_SUMMARY;
