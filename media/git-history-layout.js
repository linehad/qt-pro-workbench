(() => {
    const DEFAULT_RATIOS = [0.5, 0.2, 0.3];
    const normalizeRatios = ratios => {
        const values = Array.isArray(ratios) && ratios.length === 3 ? ratios.map(value => Number.isFinite(value) && value >= 0 ? value : 0) : DEFAULT_RATIOS;
        const total = values.reduce((sum, value) => sum + value, 0);
        return total > 0 ? values.map(value => value / total) : [...DEFAULT_RATIOS];
    };
    const fitPaneHeights = (available, ratios, minimums) => {
        const total = minimums.reduce((sum, value) => sum + value, 0);
        if (available < total) { return minimums.map(value => Math.max(0, available) * value / total); }
        return normalizeRatios(ratios).map((value, index) => minimums[index] + (available - total) * value);
    };
    const resizePanePair = (heights, index, delta, minimums) => {
        const result = [...heights];
        const change = Math.max(minimums[index] - heights[index], Math.min(delta, heights[index + 1] - minimums[index + 1]));
        result[index] += change; result[index + 1] -= change;
        return result;
    };
    const ratiosForHeights = (heights, minimums) => normalizeRatios(heights.map((value, index) => Math.max(0, value - minimums[index])));
    if (typeof module !== "undefined") { module.exports = { fitPaneHeights, resizePanePair, ratiosForHeights }; return; }

    const initialize = (saved, remember) => {
        const main = document.querySelector("main");
        const panes = ["commit-list", "commit-detail", "changed-panel"].map(id => document.getElementById(id));
        const splitters = ["message-splitter", "changes-splitter"].map(id => document.getElementById(id));
        let ratios = normalizeRatios(saved);
        let heights = [];
        let dragging = null;
        const minimums = () => window.innerHeight <= 560 ? [70, 50, 130] : [100, 75, 160];
        const availableHeight = () => {
            const style = getComputedStyle(main);
            const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
            const gaps = parseFloat(style.rowGap) * (main.children.length - 1);
            const fixed = [...main.children].filter(child => !panes.includes(child)).reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
            return Math.max(0, main.clientHeight - padding - gaps - fixed);
        };
        const apply = values => {
            heights = values;
            main.style.gridTemplateRows = `auto auto ${values[0]}px auto 6px ${values[1]}px 6px ${values[2]}px auto`;
            const limits = minimums();
            splitters.forEach((splitter, index) => {
                splitter.setAttribute("aria-valuemin", String(Math.round(limits[index])));
                splitter.setAttribute("aria-valuemax", String(Math.round(values[index] + values[index + 1] - limits[index + 1])));
                splitter.setAttribute("aria-valuenow", String(Math.round(values[index])));
            });
        };
        const render = () => {
            if (!main.clientHeight || dragging) { return; }
            main.style.minHeight = "";
            const limits = minimums();
            const required = limits.reduce((sum, value) => sum + value, 0);
            const shortage = required - availableHeight();
            if (shortage > 0) { main.style.minHeight = `${main.clientHeight + shortage}px`; }
            apply(fitPaneHeights(availableHeight(), ratios, limits));
        };
        const persist = () => { ratios = ratiosForHeights(heights, minimums()); remember(ratios); };
        const finish = () => {
            if (!dragging) { return; }
            const { splitter, pointerId } = dragging; dragging = null;
            document.body.classList.remove("history-resizing"); splitter.classList.remove("dragging");
            if (splitter.hasPointerCapture(pointerId)) { splitter.releasePointerCapture(pointerId); }
            persist(); render();
        };
        splitters.forEach((splitter, index) => {
            splitter.addEventListener("pointerdown", event => {
                if (event.button !== 0) { return; }
                event.preventDefault(); dragging = { splitter, pointerId: event.pointerId, startY: event.clientY, heights: [...heights] };
                splitter.setPointerCapture(event.pointerId); document.body.classList.add("history-resizing"); splitter.classList.add("dragging");
            });
            splitter.addEventListener("pointermove", event => {
                if (dragging?.splitter !== splitter) { return; }
                apply(resizePanePair(dragging.heights, index, event.clientY - dragging.startY, minimums()));
            });
            for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) { splitter.addEventListener(name, finish); }
            splitter.addEventListener("keydown", event => {
                const deltas = { ArrowUp: -24, ArrowDown: 24, Home: -Infinity, End: Infinity };
                if (!(event.key in deltas)) { return; }
                event.preventDefault(); apply(resizePanePair(heights, index, deltas[event.key], minimums())); persist();
            });
            splitter.addEventListener("dblclick", () => { ratios = [...DEFAULT_RATIOS]; render(); remember(ratios); });
        });
        window.addEventListener("resize", () => { finish(); render(); });
        const observer = new ResizeObserver(render);
        observer.observe(main);
        for (const child of main.children) { if (!panes.includes(child)) { observer.observe(child); } }
        render();
    };
    window.GitHistoryLayout = { initialize };
})();
