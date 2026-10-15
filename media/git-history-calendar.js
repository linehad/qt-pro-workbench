(() => {
    const makeDate = (year, month, day) => { const date = new Date(0); date.setHours(0, 0, 0, 0); date.setFullYear(year, month, day); return date; };
    const dateKey = date => `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const parseDate = value => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { return null; }
        const [year, month, day] = value.split("-").map(Number);
        if (year < 1 || year > 9999) { return null; }
        const date = makeDate(year, month - 1, day);
        return dateKey(date) === value ? date : null;
    };
    const monthGrid = (year, month) => {
        const first = makeDate(year, month, 1);
        const start = 1 - first.getDay();
        return Array.from({ length: 42 }, (_, index) => makeDate(year, month, start + index));
    };
    if (typeof module !== "undefined") { module.exports = { parseDate, dateKey, monthGrid }; return; }

    const element = id => document.getElementById(id);
    const popup = element("calendar");
    const today = new Date();
    let activeInput = null;
    let year = today.getFullYear();
    let month = today.getMonth();
    let selected = "";

    const hide = (restoreFocus = false) => {
        popup.hidden = true;
        if (activeInput) { activeInput.setAttribute("aria-expanded", "false"); }
        if (restoreFocus && activeInput) { activeInput.focus(); }
        activeInput = null;
    };
    const choose = value => {
        if (!activeInput) { return; }
        activeInput.value = value;
        activeInput.dispatchEvent(new Event("input", { bubbles: true }));
        hide(true);
    };
    const render = () => {
        const years = Array.from({ length: 111 }, (_, index) => today.getFullYear() - 100 + index);
        if (!years.includes(year)) { years.push(year); years.sort((left, right) => left - right); }
        element("calendar-year").replaceChildren();
        for (const value of years) {
            const option = document.createElement("option"); option.value = value; option.textContent = `${value}년`; element("calendar-year").append(option);
        }
        element("calendar-year").value = year;
        element("calendar-month").value = month;
        element("calendar-prev").disabled = year === 1 && month === 0;
        element("calendar-next").disabled = year === 9999 && month === 11;
        element("calendar-days").replaceChildren();
        for (const date of monthGrid(year, month)) {
            const key = dateKey(date);
            const button = document.createElement("button"); button.type = "button"; button.textContent = date.getDate(); button.dataset.date = key;
            button.classList.toggle("outside", date.getMonth() !== month); button.classList.toggle("selected", key === selected); button.classList.toggle("today", key === dateKey(today));
            button.disabled = date.getFullYear() < 1 || date.getFullYear() > 9999;
            button.setAttribute("aria-label", `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`); button.setAttribute("aria-pressed", String(key === selected));
            button.addEventListener("click", () => choose(key)); element("calendar-days").append(button);
        }
    };
    const show = (input, focusCalendar = false) => {
        if (!popup.hidden && activeInput === input) {
            if (focusCalendar) { popup.querySelector("button.selected, button.today")?.focus(); }
            return;
        }
        hide(); activeInput = input;
        const date = parseDate(input.value) || today; year = date.getFullYear(); month = date.getMonth(); selected = input.value;
        render(); popup.hidden = false; input.setAttribute("aria-expanded", "true");
        const anchor = input.getBoundingClientRect(); const height = popup.offsetHeight;
        popup.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - popup.offsetWidth - 8))}px`;
        const below = anchor.bottom + 5;
        popup.style.top = `${Math.max(8, below + height > window.innerHeight ? anchor.top - height - 5 : below)}px`;
        if (focusCalendar) { const focus = popup.querySelector(`[data-date="${dateKey(date)}"]`); if (focus) { focus.focus(); } }
    };
    const navigate = delta => { const date = makeDate(year, month + delta, 1); year = date.getFullYear(); month = date.getMonth(); render(); };
    for (let index = 0; index < 12; ++index) {
        const option = document.createElement("option"); option.value = index; option.textContent = `${index + 1}월`; element("calendar-month").append(option);
    }
    for (const id of ["from", "to"]) {
        const input = element(id);
        input.addEventListener("click", () => show(input));
        input.addEventListener("input", () => input.setAttribute("aria-invalid", String(!!input.value && !parseDate(input.value))));
        input.addEventListener("keydown", event => { if (event.key === "ArrowDown" && event.altKey) { event.preventDefault(); show(input, true); } });
    }
    element("calendar-year").addEventListener("change", () => { year = Number(element("calendar-year").value); render(); });
    element("calendar-month").addEventListener("change", () => { month = Number(element("calendar-month").value); render(); });
    element("calendar-prev").addEventListener("click", () => navigate(-1));
    element("calendar-next").addEventListener("click", () => navigate(1));
    element("calendar-today").addEventListener("click", () => choose(dateKey(today)));
    element("calendar-clear").addEventListener("click", () => choose(""));
    element("calendar-close").addEventListener("click", () => hide(true));
    document.addEventListener("keydown", event => { if (!popup.hidden && event.key === "Escape") { event.preventDefault(); hide(true); } });
    document.addEventListener("pointerdown", event => { if (!popup.hidden && !popup.contains(event.target)) { if (!activeInput?.contains(event.target)) { hide(); } } });
    window.addEventListener("resize", () => hide());
    window.GitHistoryCalendar = { value: input => parseDate(input.value) ? input.value : "" };
})();
