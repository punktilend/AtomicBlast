#!/bin/bash
LOG="/tmp/claude-0/-root/33bd25b4-b5cb-42d5-9eb8-8e556d926ddf/tasks/b8u9z017d.output"

while true; do
    clear
    MOVES=$(grep -c "Moving:" "$LOG" 2>/dev/null || echo 0)
    RENAMES=$(grep -c "Renaming:" "$LOG" 2>/dev/null || echo 0)
    ERRORS=$(grep -c "WARN:" "$LOG" 2>/dev/null || echo 0)
    DONE=$(grep -q "=== Done ===" "$LOG" 2>/dev/null && echo "YES" || echo "no")
    LAST=$(grep -E "Moving:|Renaming:" "$LOG" 2>/dev/null | tail -1 | sed 's/\[.*\] //' | sed 's/.*-> /→ /')
    LASTTIME=$(grep -E "Moving:|Renaming:" "$LOG" 2>/dev/null | tail -1 | grep -oP '\d+:\d+:\d+')

    # Filled bar based on renames (rough estimate of 220 total)
    TOTAL=220
    PROG=$((MOVES + RENAMES))
    PCT=$((PROG * 100 / TOTAL))
    [ $PCT -gt 100 ] && PCT=99
    FILLED=$((PCT * 40 / 100))
    BAR=$(python3 -c "print('\033[32m' + '█'*$FILLED + '\033[90m' + '░'*(40-$FILLED) + '\033[0m')")

    echo ""
    echo "  ╔══════════════════════════════════════════════╗"
    echo "  ║         Music Library Cleanup                ║"
    echo "  ╚══════════════════════════════════════════════╝"
    echo ""
    printf "  Phase 1+2  Moves:    \033[32m%3d\033[0m / 36\n" "$MOVES"
    printf "  Phase 3    Renames:  \033[33m%3d\033[0m done\n" "$RENAMES"
    printf "  Warnings:            \033[31m%3d\033[0m\n" "$ERRORS"
    echo ""
    echo "  Progress: [$BAR] $PCT%"
    echo ""
    printf "  Last [\033[36m%s\033[0m]: %s\n" "$LASTTIME" "$LAST"
    echo ""
    if [ "$DONE" = "YES" ]; then
        printf "  \033[32m✓ ALL DONE\033[0m\n"
        break
    else
        printf "  \033[33m⟳ running...\033[0m  (refreshes every 5s, ctrl+c to exit)\n"
    fi
    echo ""
    sleep 5
done
