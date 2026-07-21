# Active timer task mutation boundary

Task `status === "doing"` can survive in old saved data after the actual timer is gone. Therefore it is not sufficient evidence that a timer currently owns the task.

UI commands compare the task ID with the persisted timer target:

- Matching task: reject schedule, duration, unlock, postpone, move, and delete mutations until the timer is finished.
- No matching timer: treat `doing` as stale, restore the task to `planned`, and apply the requested operation.

The exported pure reducer remains conservative because it cannot inspect browser timer state. Explicit `doing -> planned` updates are the recovery path used by the guarded UI command layer.
