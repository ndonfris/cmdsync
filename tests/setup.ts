/**
 * The commands in these tests are written for sh, so pin it: with `"shell": "auto"`
 * (the default) they would otherwise run in whatever shell started the tests.
 * Imported first by the tests that run commands; child processes inherit it.
 * Set CMDSYNC_SHELL yourself to run the tests with another shell.
 */
process.env.CMDSYNC_SHELL ??= 'sh';
