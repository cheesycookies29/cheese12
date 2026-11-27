// What CORE does with an error nobody caught (0.71, before YEP 2026). Until now there was no handler,
// and Node 22 stops the process on an unhandled promise rejection: one stray rejection at the event's
// peak would have restarted CORE and signed every staffer out.
//  - An unhandled promise rejection is logged and counted (Admin panel → Security monitor shows it),
//    and CORE keeps serving: the request it belonged to has already failed on its own.
//  - An uncaught exception leaves the process in an unknown state, so it is logged and counted, then
//    CORE exits with code 1 and systemd starts it again (Restart=always, 3 s).
export function installProcessGuards({ proc = process, log = console.error, beforeExit = () => {} } = {}) {
  const state = { rejections: 0, exceptions: 0, last: null, lastAt: null };
  const text = (err) => (err && err.stack) || String(err);
  proc.on('unhandledRejection', (reason) => {
    state.rejections++;
    state.last = String((reason && reason.message) || reason).slice(0, 200);
    state.lastAt = new Date().toISOString();
    log(`Unhandled promise rejection (CORE keeps running): ${text(reason)}`);
  });
  proc.on('uncaughtException', (err) => {
    state.exceptions++;
    log(`Uncaught exception: CORE stops now and systemd starts it again. ${text(err)}`);
    try {
      beforeExit(err);
    } catch {}
    proc.exit(1);
  });
  return state;
}

// The Security monitor's check for these errors.
export const processCheck = (state) => () => ({
  area: 'Server', label: 'Unhandled errors',
  state: state.rejections ? 'warn' : 'ok',
  detail: state.rejections
    ? `${state.rejections} unhandled error${state.rejections === 1 ? '' : 's'} since CORE started; the last at ${state.lastAt}: ${state.last}`
    : 'None since CORE started.',
});
