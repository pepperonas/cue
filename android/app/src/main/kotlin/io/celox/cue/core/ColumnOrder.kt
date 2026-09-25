package io.celox.cue.core

/** Port von `lib/order.ts:columnComparator`; gehalten von `contracts/column-order.json`. */
private fun priorityRank(p: PromptView): Int = when {
    p.status != Status.queued -> 1
    p.priority == Priority.high -> 0
    p.priority == Priority.low -> 2
    else -> 1
}

val columnComparator: Comparator<PromptView> = Comparator { a, b ->
    val blocked = a.blocked.compareTo(b.blocked)
    if (blocked != 0) return@Comparator blocked
    if (a.status == Status.done && b.status == Status.done) {
        val tested = a.tested.compareTo(b.tested)
        if (tested != 0) return@Comparator tested
        val close = b.testClosely.compareTo(a.testClosely)
        if (close != 0) return@Comparator close
    }
    val priority = priorityRank(a) - priorityRank(b)
    if (priority != 0) return@Comparator priority
    a.sortOrder.compareTo(b.sortOrder).takeIf { it != 0 } ?: a.id.compareTo(b.id)
}
