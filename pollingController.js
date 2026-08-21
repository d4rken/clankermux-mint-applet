/* Pure polling lifecycle helper shared by the Cinnamon applet and Node tests. */

var PollingController = (() => {
    function create(options) {
        let pollId = 0;
        let watchdogId = 0;
        let stopped = true;

        function report(error) {
            if (typeof options.onError !== 'function')
                return;
            try {
                options.onError(error);
            } catch (ignored) {
                // Error reporting must never be able to kill either timer.
            }
        }

        function notify() {
            if (typeof options.onSourcesChanged !== 'function')
                return;
            try {
                options.onSourcesChanged({ pollId, watchdogId });
            } catch (error) {
                report(error);
            }
        }

        function setPollId(value) {
            pollId = value || 0;
            notify();
        }

        function setWatchdogId(value) {
            watchdogId = value || 0;
            notify();
        }

        function sourceExists(id) {
            if (!id)
                return false;
            try {
                return options.sourceExists(id) !== false;
            } catch (error) {
                report(error);
                // If the runtime cannot query sources, preserve the historical
                // behavior and avoid removing an ID on incomplete information.
                return true;
            }
        }

        function removeIfAlive(id) {
            if (!id || !sourceExists(id))
                return;
            try {
                options.removeSource(id);
            } catch (error) {
                report(error);
            }
        }

        function secondsFrom(getter, fallback) {
            let value = fallback;
            try {
                value = Number(getter());
            } catch (error) {
                report(error);
            }
            return Number.isFinite(value) && value > 0 ? Math.ceil(value) : fallback;
        }

        function armPoll() {
            if (stopped || sourceExists(pollId))
                return;
            if (pollId)
                setPollId(0);

            const seconds = secondsFrom(options.intervalSeconds, 30);
            let id = 0;
            try {
                id = options.addTimeoutSeconds(seconds, () => {
                    if (pollId === id)
                        setPollId(0);
                    try {
                        if (!stopped)
                            options.poll();
                    } catch (error) {
                        report(error);
                    } finally {
                        // A thrown refresh used to remove the repeating GLib
                        // source permanently. A one-shot re-armed in finally
                        // keeps polling alive after every callback failure.
                        if (!stopped)
                            armPoll();
                    }
                    return false;
                });
            } catch (error) {
                report(error);
            }
            setPollId(id);
        }

        function armWatchdog() {
            if (stopped || sourceExists(watchdogId))
                return;
            if (watchdogId)
                setWatchdogId(0);

            const seconds = secondsFrom(
                options.watchdogIntervalSeconds || (() => 30),
                30
            );
            let id = 0;
            try {
                id = options.addTimeoutSeconds(seconds, () => {
                    if (stopped || watchdogId !== id)
                        return false;
                    try {
                        ensure(true);
                    } catch (error) {
                        report(error);
                    }
                    return true;
                });
            } catch (error) {
                report(error);
            }
            setWatchdogId(id);
        }

        function ensure(refreshAfterRecovery = false) {
            if (stopped)
                return;
            const pollWasMissing = Boolean(pollId && !sourceExists(pollId));
            if (pollWasMissing)
                setPollId(0);
            if (watchdogId && !sourceExists(watchdogId))
                setWatchdogId(0);
            armPoll();
            armWatchdog();
            if (refreshAfterRecovery && pollWasMissing) {
                try {
                    options.poll();
                } catch (error) {
                    report(error);
                }
            }
        }

        function start() {
            stopped = false;
            ensure();
        }

        function restart() {
            const oldPollId = pollId;
            const oldWatchdogId = watchdogId;
            setPollId(0);
            setWatchdogId(0);
            removeIfAlive(oldPollId);
            removeIfAlive(oldWatchdogId);
            stopped = false;
            ensure();
        }

        function stop() {
            stopped = true;
            const oldPollId = pollId;
            const oldWatchdogId = watchdogId;
            setPollId(0);
            setWatchdogId(0);
            removeIfAlive(oldPollId);
            removeIfAlive(oldWatchdogId);
        }

        function sourceIds() {
            return { pollId, watchdogId };
        }

        return { ensure, restart, sourceIds, start, stop };
    }

    return { create };
})();

if (typeof module !== 'undefined' && module.exports)
    module.exports = PollingController;
