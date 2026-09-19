window.__ModuleLoader__.load({
	id: "@comecaramelos/dsh-chrome-mcp",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var react = require("react");
		var reactJsx = require("react/jsx-runtime");
		var clientStore = require("@deepseek-ai/dsh-client-store");
		// NOTE: no UI primitives required — the extra flags editor is a plain
		// textarea writing through the controller (props.saveFlags), not the
		// shell Menu primitive the reference used for its profile picker.

		/**
		 * Chrome DevTools MCP settings + status card, browser half.
		 *
		 * Registers one card into the shared `settings.plugin.item` slot
		 * (Settings → Plugins → Plugin configuration), keyed by the
		 * `chrome-mcp` settings namespace the host half serves. The card
		 * offers, per the product spec:
		 *   - error reporting: chrome executable / connection errors surfaced
		 *     from the host's `lastError`, reported by a single UI element: the
		 *     red status dot in the header, whose `title` carries the full
		 *     message. A served `chromeMissing` flag keeps that dot red even
		 *     when the captured error was cleared (its title then falls back to
		 *     the not-found label). No body paragraph, no extra badge.
		 *   - an extra flags editor (host field `extraFlags`, one flag per
		 *     line, default `--no-usage-statistics`, `--no-performance-crux`), writing the persisted
		 *     field via scope.set (host fiber.update relaunches the bridge),
		 *   - the Chrome executable version discovered by the last check, and
		 *   - the full configuration-guide message with a link to
		 *     https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md
		 * The card is collapsible like the stock plugin cards: closed by
		 * default, with the header as its disclosure button.
		 */
		/** Settings namespace served by the host half; also the slot key. */
		var NS = "chrome-mcp";
		/** Locale dictionary namespace. */
		var LOCALE_NS = "chromeMcp";
		/** Required services (cordis fiber inject). */
		var inject = ["slots", "locale", "settingsScope"];

		/** Configuration docs link (must match host CONFIGURATION_DOCS_URL). */
		var CONFIGURATION_URL =
			"https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md";

		// ── card styles ────────────────────────────────────────────────────
		var CSS = {
			card: "dshcmc_card",
			cardOpen: "dshcmc_cardOpen",
			header: "dshcmc_header",
			headText: "dshcmc_headText",
			nameRow: "dshcmc_nameRow",
			name: "dshcmc_name",
			desc: "dshcmc_desc",
			chevron: "dshcmc_chevron",
			chevronOpen: "dshcmc_chevronOpen",
			body: "dshcmc_body",
			field: "dshcmc_field",
			rowText: "dshcmc_rowText",
			fieldTitle: "dshcmc_fieldTitle",
			fieldDesc: "dshcmc_fieldDesc",
			row: "dshcmc_row",
			button: "dshcmc_button",
			readOnly: "dshcmc_readOnly",
			dot: "dshcmc_dot",
			dotError: "dshcmc_dotError",
			link: "dshcmc_link",
			value: "dshcmc_value",
			docs: "dshcmc_docs",
			editor: "dshcmc_editor",
			text: "dshcmc_text"
		};
		var css =
			"." + CSS.card + "{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}" +
			"." + CSS.card + ":hover{border-color:var(--dsw-alias-label-dimmed)}" +
			"." + CSS.cardOpen + "{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}" +
			"." + CSS.header + "{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}" +
			"." + CSS.header + ":focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}" +
			"." + CSS.headText + "{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}" +
			"." + CSS.nameRow + "{align-items:center;gap:8px;min-width:0;display:flex}" +
			"." + CSS.name + "{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}" +
			"." + CSS.desc + "{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
			"." + CSS.chevron + "{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}" +
			"." + CSS.chevronOpen + "{transform:rotate(180deg)}" +
			"." + CSS.body + "{border-top:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:10px;margin:0 16px;padding:12px 0}" +
			"." + CSS.field + "{align-items:flex-start;gap:8px;display:flex}" +
			"." + CSS.rowText + "{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}" +
			"." + CSS.fieldTitle + "{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}" +
			"." + CSS.fieldDesc + "{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}" +
			"." + CSS.row + "{display:flex;gap:10px;align-items:center}" +
			"." + CSS.button +
			"{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:.5px solid var(--dsw-alias-border-l3);" +
			"border-radius:14px;cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);" +
			"background:transparent;padding:0 10px;height:28px}" +
			"." + CSS.button + ":hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
			"." + CSS.button + ":disabled{cursor:not-allowed;opacity:.4}" +
			"." + CSS.button + ":focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}" +
			"." + CSS.readOnly + "{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}" +
			"." + CSS.dot + "{box-sizing:border-box;corner-shape:round;border-radius:50%;flex:none;width:8px;height:8px;display:inline-block}" +
			"." + CSS.dotError + "{background:var(--dsw-alias-state-error-primary)}" +
			"." + CSS.link + "{color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:12px;line-height:1.5}" +
			"." + CSS.link + ":hover{text-decoration:underline}" +
			"." + CSS.value + "{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.5;white-space:pre-wrap}" +
			"." + CSS.docs + "{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;overflow-wrap:anywhere}" +
			"." + CSS.editor + "{flex-direction:column;gap:8px;display:flex}" +
			"." + CSS.text +
			"{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);" +
			"color:var(--dsw-alias-label-primary);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.5;" +
			"padding:6px 10px;min-height:64px;resize:vertical}" +
			"." + CSS.text + ":focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}";
		var TAG_ID = "@comecaramelos/dsh-chrome-mcp/ChromeMcpCard.module.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + TAG_ID + '"]') === null) {
			var tag = document.createElement("style");
			tag.dataset.plugin = "@comecaramelos/dsh-chrome-mcp";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ── locale dictionaries ────────────────────────────────────────────
		var en = {
			title: "Chrome DevTools MCP",
			description: "Chrome DevTools MCP server (chrome-devtools-mcp) settings and status",
			flagsTitle: "Extra flags",
			flagsHint: "One flag per line, appended to `npx -y chrome-devtools-mcp@latest`. Defaults to --no-usage-statistics, --no-performance-crux.",
			flagsPlaceholder: "No extra flags",
			flagsSave: "Save flags",
			versionTitle: "Detected Chrome version",
			check: "Re-check Chrome",
			checking: "Checking…",
			docsMessage: "Find the complete list of server parameters (e.g., --headless, --isolated, --slim) and how to configure WebSocket connections in the Configuration Guide:",
			statusError: "Error",
			statusOk: "OK",
			chromeMissing: "Chrome executable not found",
			readOnly: "Settings are read-only in this deployment.",
			expand: "Expand",
			collapse: "Collapse"
		};
		// ── card controller ────────────────────────────────────────────────
		/** Re-describe cadence (ms) while waiting for the host's check run. */
		var CHECK_POLL_TICK_MS = 700;
		/** Give up waiting for the check revision to advance after this (ms). The host check subprocess times out at 15s. */
		var CHECK_POLL_TIMEOUT_MS = 20000;
		/**
		 * Projects the bound `chrome-mcp` settings scope onto a snapshot store
		 * the card reads through its `useChromeMcpCard` hook, and owns the two
		 * write actions (save flags, re-check). `mirror` is the shared
		 * settings describe mirror (`settingsScope.describe()`) the re-check
		 * action re-reads while the host's in-memory check status is still en
		 * route — module plugins have no client→host push channel beyond
		 * persisted writes.
		 */
		var ChromeMcpCardController = class {
			constructor(scope, mirror) {
				this.scope = scope;
				this.mirror = mirror;
				this.disposed = false;
				this.pollTimer = null;
				this.pollGeneration = 0;
				this.checkWaitStarted = false;
				this.store = clientStore.createSnapshotStore({
					available: false,
					writable: false,
					extraFlags: [],
					lastError: "",
					chromeMissing: false,
					checkRevision: 0,
					chromeVersion: "",
					actionError: ""
				});
				this.unsubscribe = scope.subscribe(() => this.publish());
				this.publish();
			}
			/** Republish the latest scope snapshot into the card store. */
			publish() {
				if (this.disposed) return;
				var previous = this.store.getSnapshot();
				var snapshot = this.scope.getSnapshot();
				if (snapshot.status !== "ready" || snapshot.value === void 0) {
					this.store.set({
						available: false,
						writable: false,
						extraFlags: [],
						lastError: "",
						chromeMissing: false,
						checkRevision: 0,
						chromeVersion: "",
						actionError: previous.actionError
					});
					return;
				}
				var value = snapshot.value;
				// The status fields (lastError / chromeMissing / checkRevision /
				// chromeVersion) ride the composition **base** layer: describe()
				// clones that entry object fresh on every read, while the frozen
				// resolved `value` folds the base in only at commits. Base-only
				// host changes — the registration-time check, bridge-log and
				// tool-call captures — are therefore invisible to `value`, so
				// status is read from `base`, falling back to `value` only when
				// the read carries no base layer. `extraFlags` keeps reading
				// `value`: the persisted user layer wins there, not the
				// host-seeded entry field.
				var base = snapshot.base ?? {};
				var servedRevision =
					typeof base.checkRevision === "number"
						? base.checkRevision
						: typeof value.checkRevision === "number"
							? value.checkRevision
							: 0;
				this.store.set({
					available: true,
					writable: snapshot.writable === true,
					extraFlags: Array.isArray(value.extraFlags) ? value.extraFlags : [],
					lastError: typeof base.lastError === "string" ? base.lastError : (value.lastError ?? ""),
					chromeMissing: base.chromeMissing === undefined ? value.chromeMissing === true : base.chromeMissing === true,
					checkRevision: servedRevision,
					chromeVersion: typeof base.chromeVersion === "string" ? base.chromeVersion : (typeof value.chromeVersion === "string" ? value.chromeVersion : ""),
					actionError: ""
				});
				// Startup catch-up: the registration-time executable check lands
				// in the base layer *after* this first describe read, and a
				// module plugin has no push channel — poll the shared describe
				// mirror until the served revision advances (the same budget the
				// re-check waits with). A card attaching after the check already
				// ran sees a nonzero revision and does not poll.
				if (!this.checkWaitStarted) {
					this.checkWaitStarted = true;
					if (servedRevision === 0) this.waitForCheck(0, Date.now() + CHECK_POLL_TIMEOUT_MS);
				}
			}
			/**
			 * Immediate write of the user's extra flags (persisted; the host's
			 * validate hook rejects invalid lists here, and the next bridge
			 * launch starts with them).
			 */
			saveFlags(flags) {
				return this.scope.set("extraFlags", flags).catch((error) => this.noteError(error));
			}
			/**
			 * Ask the host to re-run the Chrome executable/connection check,
			 * then wait for the result: write `recheckNonce`, then poll the
			 * shared describe mirror until the served `checkRevision` advances
			 * past the click-time value — or the check timeout budget elapses.
			 */
			recheck() {
				if (this.disposed) return Promise.resolve();
				var baseline = this.store.getSnapshot().checkRevision;
				var wait = this.waitForCheck(baseline, Date.now() + CHECK_POLL_TIMEOUT_MS);
				return this.scope
					.set("recheckNonce", Date.now())
					.catch((error) => this.noteError(error))
					.then(() => wait);
			}
			/** Re-describe the settings mirror every tick until the check revision advances or the deadline passes. */
			waitForCheck(baseline, deadline) {
				var controller = this;
				// A new wait supersedes any pending one (the startup catch-up
				// poll yielding to a manual re-check), so exactly one poll loop
				// runs and the superseded wait settles instead of dangling.
				var generation = ++controller.pollGeneration;
				return new Promise((resolve) => {
					var timer;
					var settled = false;
					var arm = (delay) => {
						timer = setTimeout(tick, delay);
						controller.pollTimer = timer;
					};
					var finish = () => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						if (controller.pollTimer === timer) controller.pollTimer = null;
						resolve();
					};
					var satisfied = () =>
						controller.store.getSnapshot().checkRevision > baseline || Date.now() >= deadline;
					var stale = () => controller.disposed || generation !== controller.pollGeneration;
					var tick = () => {
						if (stale() || satisfied()) {
							finish();
							return;
						}
						var loaded;
						try {
							loaded = controller.mirror.load();
						} catch (error) {
							loaded = void 0; // mirror read failure: the next tick retries
						}
						Promise.resolve(loaded)
							.catch(() => {})
							.then(() => {
								if (stale() || satisfied()) {
									finish();
									return;
								}
								arm(CHECK_POLL_TICK_MS);
							});
					};
					arm(CHECK_POLL_TICK_MS);
				});
			}
			noteError(error) {
				if (this.disposed) return;
				var previous = this.store.getSnapshot();
				this.store.set({
					...previous,
					actionError: error != null && typeof error.message === "string" ? error.message : String(error)
				});
			}
			/** The face the card's slot registration injects. */
			inject() {
				return {
					hooks: { chromeMcpCard: this.store },
					saveFlags: (flags) => this.saveFlags(flags),
					recheck: () => this.recheck(),
					/** One mirror re-read (used when the card opens). */
					refresh: () => this.refresh()
				};
			}
			/**
			 * Re-read the shared describe mirror once so base-layer status
			 * captured asynchronously by the host (bridge connection errors)
			 * reaches an opened card without waiting for a write or a re-check.
			 */
			refresh() {
				if (this.disposed) return Promise.resolve();
				var load;
				try {
					load = this.mirror.load();
				} catch (error) {
					load = void 0;
				}
				return Promise.resolve(load).catch(() => {});
			}
			dispose() {
				this.disposed = true;
				if (this.pollTimer !== null) {
					clearTimeout(this.pollTimer);
					this.pollTimer = null;
				}
				this.unsubscribe();
			}
		};

		// ── card component ─────────────────────────────────────────────────
		/** Chevron matching the shell's IconChevronDownOutline14 primitive. */
		var CHEVRON_PATH =
			"M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z";

		/**
		 * Render the Chrome DevTools MCP settings/status card. Collapsible
		 * like the stock plugin cards: the header is a disclosure button
		 * (closed by default) and the controls live in the body.
		 * @param props - locale copy, the card snapshot hook, and its actions.
		 * @returns the card, or nothing until the namespace is served.
		 */
		function ChromeMcpCard(props) {
			var t = props.t;
			var state = props.useChromeMcpCard((snapshot) => snapshot);
			var openState = react.useState(false);
			var open = openState[0];
			var setOpen = openState[1];
			var checkingState = react.useState(false);
			var isChecking = checkingState[0];
			var setChecking = checkingState[1];
			var bodyId = react.useId();
			var flagsRef = react.useRef(null);
			if (!state.available) return null;
			// Header status dot: the single error surface. Red while a
			// check/connection error, a rejected action, or the known
			// executable-missing flag (which survives bridge-update-success
			// clears of lastError) is present; hidden while healthy.
			var error = state.lastError || state.actionError || "";
			var tip = error !== "" ? error : state.chromeMissing === true ? t("chromeMissing") : "";
			var dotAria = tip !== "" ? t("statusError") : t("statusOk");
			return (0, reactJsx.jsx)("li", {
				className: CSS.card + (open ? " " + CSS.cardOpen : ""),
				children: [
					(0, reactJsx.jsxs)("button", {
						type: "button",
						className: CSS.header,
						"aria-expanded": open,
						"aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
						"aria-controls": bodyId,
						onClick: () => {
							setOpen(!open);
							if (!open && typeof props.refresh === "function") props.refresh();
						},
						children: [
							(0, reactJsx.jsxs)("span", {
								className: CSS.headText,
								children: [
									(0, reactJsx.jsxs)("div", {
										className: CSS.nameRow,
										children: [
											(0, reactJsx.jsx)("span", {
												className: CSS.name,
												children: t("title")
											}),
											tip !== ""
												? (0, reactJsx.jsx)("span", {
													className: CSS.dot + " " + CSS.dotError,
													role: "img",
													"aria-label": dotAria,
													title: tip
												})
												: null
										]
									}),
									(0, reactJsx.jsx)("span", { className: CSS.desc, children: t("description") })
								]
							}),
							(0, reactJsx.jsx)("svg", {
								width: 14,
								height: 14,
								className: CSS.chevron + (open ? " " + CSS.chevronOpen : ""),
								viewBox: "0 0 14 14",
								fill: "none",
								xmlns: "http://www.w3.org/2000/svg",
								children: (0, reactJsx.jsx)("path", { d: CHEVRON_PATH, fill: "currentColor" })
							})
						]
					}),
					open
						? (0, reactJsx.jsxs)("div", {
								id: bodyId,
								className: CSS.body,
								children: [
									!state.writable
										? (0, reactJsx.jsx)("p", { className: CSS.readOnly, role: "status", children: t("readOnly") })
										: null,
									(0, reactJsx.jsxs)("div", {
										className: CSS.field,
										children: [
											(0, reactJsx.jsxs)("div", {
												className: CSS.rowText,
												children: [
													(0, reactJsx.jsx)("div", { className: CSS.fieldTitle, children: t("flagsTitle") }),
													(0, reactJsx.jsx)("div", { className: CSS.fieldDesc, children: t("flagsHint") })
												]
											})
										]
									}),
									// Extra flags editor: one flag per line; the write goes
									// through props.saveFlags (host validate + fiber.update).
									// `key` re-mounts the textarea when the store value
									// changes underneath the editor (e.g. a save from another
									// window), so the shown value never drifts.
									state.writable
										? (0, reactJsx.jsxs)("div", {
												className: CSS.editor,
												children: [
													(0, reactJsx.jsx)("textarea", {
														className: CSS.text,
														rows: Math.max(3, state.extraFlags.length),
														placeholder: t("flagsPlaceholder"),
														defaultValue: state.extraFlags.join("\n"),
														key: state.extraFlags.join("\n"),
														ref: flagsRef
													}),
													(0, reactJsx.jsx)("div", {
														className: CSS.row,
														children: (0, reactJsx.jsx)("button", {
															type: "button",
															className: CSS.button,
															disabled: !state.writable,
															onClick: () => {
																var raw = flagsRef.current && typeof flagsRef.current.value === "string" ? flagsRef.current.value : "";
																props.saveFlags(
																	raw
																		.split(/\r?\n/u)
																		.map((line) => line.trim())
																		.filter((line) => line !== "")
																);
															},
															children: t("flagsSave")
														})
													})
												]
											})
										: (0, reactJsx.jsx)("p", {
												className: CSS.value,
												children:
													state.extraFlags.length > 0 ? state.extraFlags.join("\n") : t("flagsPlaceholder")
											}),
									(0, reactJsx.jsxs)("div", {
										className: CSS.row,
										children: [
											(0, reactJsx.jsx)("button", {
												type: "button",
												className: CSS.button,
												disabled: !state.writable || isChecking,
												onClick: () => {
													setChecking(true);
													var checkPromise;
													try {
														checkPromise = props.recheck();
													} catch (error) {
														checkPromise = Promise.reject(error);
													}
													if (checkPromise == null || typeof checkPromise.finally !== "function") {
														checkPromise = Promise.resolve(checkPromise);
													}
													checkPromise.finally(() => setChecking(false));
												},
												children: isChecking ? t("checking") : t("check")
											})
										]
									}),
									// Executable version discovered by the last check.
									state.chromeVersion !== ""
										? (0, reactJsx.jsxs)("div", {
												className: CSS.field,
												children: [
													(0, reactJsx.jsxs)("div", {
														className: CSS.rowText,
														children: [
															(0, reactJsx.jsx)("div", { className: CSS.fieldTitle, children: t("versionTitle") }),
															(0, reactJsx.jsx)("p", {
																className: CSS.value,
																children: state.chromeVersion
															})
														]
													})
												]
											})
										: null,
									// Product spec: the full configuration-guide message, with
									// the upstream URL rendered as the external link.
									(0, reactJsx.jsxs)("p", {
										className: CSS.docs,
										children: [
											t("docsMessage") + " ",
											(0, reactJsx.jsx)("a", {
												className: CSS.link,
												href: CONFIGURATION_URL,
												target: "_blank",
												rel: "noopener noreferrer",
												children: CONFIGURATION_URL
											})
										]
									})
								]
							})
						: null
				]
			});
		}

		// ── plugin body ────────────────────────────────────────────────────
		/**
		 * Mount the settings/status card.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(LOCALE_NS, { en }), "chrome-mcp: dictionaries");
			var binder = ctx.settingsScope;
			var scope = binder.bind({ namespace: NS });
			// The shared describe mirror: the recheck action re-reads it while
			// the host's in-memory check status is en route.
			var controller = new ChromeMcpCardController(scope, binder.describe());
			ctx.effect(
				() => () => controller.dispose(),
				"chrome-mcp: card controller"
			);
			ctx.slots.inject("settings.plugin.item", () =>
				ctx.slots.register(
					{
						name: "settings.plugin.item",
						key: NS,
						locale: LOCALE_NS,
						inject: () => controller.inject()
					},
					ChromeMcpCard
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
