import I18n from "I18n";
import { PIE_CHART_TYPE } from "discourse/plugins/poll/controllers/poll-ui-builder";
import RawHtml from "discourse/widgets/raw-html";
import { ajax } from "discourse/lib/ajax";
import { avatarFor } from "discourse/widgets/post";
import { createWidget } from "discourse/widgets/widget";
import evenRound from "discourse/plugins/poll/lib/even-round";
import { getColors } from "discourse/plugins/poll/lib/chart-colors";
import { h } from "virtual-dom";
import { iconNode } from "discourse-common/lib/icon-library";
import loadScript from "discourse/lib/load-script";
import { popupAjaxError } from "discourse/lib/ajax-error";
import { relativeAge } from "discourse/lib/formatter";
import round from "discourse/lib/round";
import showModal from "discourse/lib/show-modal";

const FETCH_VOTERS_COUNT = 25;

function optionHtml(option) {
  const $node = $(`<span>${option.html}</span>`);

  $node.find(".discourse-local-date").each((_index, elem) => {
    $(elem).applyLocalDates();
  });

  return new RawHtml({ html: `<span>${$node.html()}</span>` });
}

function infoTextHtml(text) {
  return new RawHtml({
    html: `<span class="info-text">${text}</span>`,
  });
}

function _fetchVoters(data) {
  return ajax("/polls/voters.json", { data }).catch((error) => {
    if (error) {
      popupAjaxError(error);
    } else {
      bootbox.alert(I18n.t("poll.error_while_fetching_voters"));
    }
  });
}

function checkUserGroups(user, poll) {
  const pollGroups =
    poll && poll.groups && poll.groups.split(",").map((g) => g.toLowerCase());

  if (!pollGroups) {
    return true;
  }

  const userGroups =
    user && user.groups && user.groups.map((g) => g.name.toLowerCase());

  return userGroups && pollGroups.some((g) => userGroups.includes(g));
}

createWidget("discourse-poll-option", {
  tagName: "li",

  buildAttributes(attrs) {
    return { tabindex: 0, "data-poll-option-id": attrs.option.id };
  },

  html(attrs) {
    const contents = [];
    const { option, vote } = attrs;
    const chosen = vote.includes(option.id);

    if (attrs.isMultiple) {
      contents.push(iconNode(chosen ? "far-check-square" : "far-square"));
    } else {
      contents.push(iconNode(chosen ? "circle" : "far-circle"));
    }

    contents.push(" ");
    contents.push(optionHtml(option));

    return contents;
  },

  click(e) {
    if ($(e.target).closest("a").length === 0) {
      this.sendWidgetAction("toggleOption", this.attrs.option);
    }
  },

  keyDown(e) {
    if (e.keyCode === 13) {
      this.click(e);
    }
  },
});

createWidget("discourse-poll-load-more", {
  tagName: "div.poll-voters-toggle-expand",
  buildKey: (attrs) => `load-more-${attrs.optionId}`,

  defaultState() {
    return { loading: false };
  },

  html(attrs, state) {
    return state.loading
      ? h("div.spinner.small")
      : h("a", iconNode("chevron-down"));
  },

  click() {
    const { state, attrs } = this;

    if (state.loading) {
      return;
    }

    state.loading = true;
    return this.sendWidgetAction("fetchVoters", attrs.optionId).finally(
      () => (state.loading = false)
    );
  },
});

createWidget("discourse-poll-voters", {
  tagName: "ul.poll-voters-list",
  buildKey: (attrs) => `poll-voters-${attrs.optionId}`,

  defaultState() {
    return {
      loaded: "new",
      voters: [],
      page: 1,
    };
  },

  html(attrs) {
    const contents = attrs.voters.map((user) =>
      h("li", [
        avatarFor("tiny", {
          username: user.username,
          template: user.avatar_template,
        }),
        " ",
      ])
    );

    if (attrs.voters.length < attrs.totalVotes) {
      contents.push(this.attach("discourse-poll-load-more", attrs));
    }

    return h("div.poll-voters", contents);
  },
});

createWidget("discourse-poll-standard-results", {
  tagName: "ul.results",
  buildKey: (attrs) => `poll-standard-results-${attrs.id}`,

  defaultState() {
    return { loaded: false };
  },

  fetchVoters(optionId) {
    const { attrs, state } = this;

    if (!state.page) {
      state.page = {};
    }

    if (!state.page[optionId]) {
      state.page[optionId] = 1;
    }

    return _fetchVoters({
      post_id: attrs.post.id,
      poll_name: attrs.poll.name,
      option_id: optionId,
      page: state.page[optionId] + 1,
      limit: FETCH_VOTERS_COUNT,
    }).then((result) => {
      if (!state.voters[optionId]) {
        state.voters[optionId] = [];
      }

      if (result.voters[optionId] && result.voters[optionId].length > 0) {
        state.voters[optionId] = [
          ...new Set([...state.voters[optionId], ...result.voters[optionId]]),
        ];
        state.page[optionId]++;
      }

      this.scheduleRerender();
    });
  },

  html(attrs, state) {
    const { poll } = attrs;
    const options = poll.get("options");

    if (options) {
      const voters = poll.get("voters");
      const isPublic = poll.get("public");

      const ordered = [...options].sort((a, b) => {
        if (a.votes < b.votes) {
          return 1;
        } else if (a.votes === b.votes) {
          if (a.html < b.html) {
            return -1;
          } else {
            return 1;
          }
        } else {
          return -1;
        }
      });

      if (isPublic && !state.loaded) {
        state.voters = poll.get("preloaded_voters");
        state.loaded = true;
      }

      const percentages =
        voters === 0
          ? Array(ordered.length).fill(0)
          : ordered.map((o) => (100 * o.votes) / voters);

      const rounded = attrs.isMultiple
        ? percentages.map(Math.floor)
        : evenRound(percentages);

      return ordered.map((option, idx) => {
        const contents = [];
        const per = rounded[idx].toString();
        const chosen = (attrs.vote || []).includes(option.id);

        contents.push(
          h(
            "div.option",
            h("p", [h("span.percentage", `${per}%`), optionHtml(option)])
          )
        );

        contents.push(
          h(
            "div.bar-back",
            h("div.bar", { attributes: { style: `width:${per}%` } })
          )
        );

        if (isPublic) {
          contents.push(
            this.attach("discourse-poll-voters", {
              postId: attrs.post.id,
              optionId: option.id,
              pollName: poll.get("name"),
              totalVotes: option.votes,
              voters: (state.voters && state.voters[option.id]) || [],
            })
          );
        }

        return h("li", { className: `${chosen ? "chosen" : ""}` }, contents);
      });
    }
  },
});

createWidget("discourse-poll-number-results", {
  buildKey: (attrs) => `poll-number-results-${attrs.id}`,

  defaultState() {
    return { loaded: false };
  },

  fetchVoters(optionId) {
    const { attrs, state } = this;

    if (!state.page) {
      state.page = 1;
    }

    return _fetchVoters({
      post_id: attrs.post.id,
      poll_name: attrs.poll.name,
      option_id: optionId,
      page: state.page + 1,
      limit: FETCH_VOTERS_COUNT,
    }).then((result) => {
      if (!state.voters) {
        state.voters = [];
      }

      if (result.voters && result.voters.length > 0) {
        state.voters = [...new Set([...state.voters, ...result.voters])];
        state.page++;
      }

      this.scheduleRerender();
    });
  },

  html(attrs, state) {
    const { poll } = attrs;

    const totalScore = poll.get("options").reduce((total, o) => {
      return total + parseInt(o.html, 10) * parseInt(o.votes, 10);
    }, 0);

    const voters = poll.get("voters");
    const average = voters === 0 ? 0 : round(totalScore / voters, -2);
    const averageRating = I18n.t("poll.average_rating", { average });
    const contents = [
      h(
        "div.poll-results-number-rating",
        new RawHtml({ html: `<span>${averageRating}</span>` })
      ),
    ];

    if (poll.get("public")) {
      if (!state.loaded) {
        state.voters = poll.get("preloaded_voters");
        state.loaded = true;
      }

      contents.push(
        this.attach("discourse-poll-voters", {
          totalVotes: poll.get("voters"),
          voters: state.voters || [],
          postId: attrs.post.id,
          pollName: poll.get("name"),
          pollType: poll.get("type"),
        })
      );
    }

    return contents;
  },
});

createWidget("discourse-poll-container", {
  tagName: "div.poll-container",

  html(attrs) {
    const { poll } = attrs;
    const options = poll.get("options");

    if (attrs.showResults) {
      const contents = [];

      if (attrs.titleHTML) {
        contents.push(new RawHtml({ html: attrs.titleHTML }));
      }

      const type = poll.get("type") === "number" ? "number" : "standard";
      const resultsWidget =
        type === "number" || attrs.poll.chart_type !== PIE_CHART_TYPE
          ? `discourse-poll-${type}-results`
          : "discourse-poll-pie-chart";
      contents.push(this.attach(resultsWidget, attrs));

      return contents;
    } else if (options) {
      const contents = [];

      if (attrs.titleHTML) {
        contents.push(new RawHtml({ html: attrs.titleHTML }));
      }

      if (!checkUserGroups(this.currentUser, poll)) {
        contents.push(
          h(
            "div.alert.alert-danger",
            I18n.t("poll.results.groups.title", { groups: poll.groups })
          )
        );
      }

      contents.push(
        h(
          "ul",
          options.map((option) => {
            return this.attach("discourse-poll-option", {
              option,
              isMultiple: attrs.isMultiple,
              vote: attrs.vote,
            });
          })
        )
      );

      return contents;
    }
  },
});

createWidget("discourse-poll-info", {
  tagName: "div.poll-info",

  multipleHelpText(min, max, options) {
    if (max > 0) {
      if (min === max) {
        if (min > 1) {
          return I18n.t("poll.multiple.help.x_options", { count: min });
        }
      } else if (min > 1) {
        if (max < options) {
          return I18n.t("poll.multiple.help.between_min_and_max_options", {
            min,
            max,
          });
        } else {
          return I18n.t("poll.multiple.help.at_least_min_options", {
            count: min,
          });
        }
      } else if (max <= options) {
        return I18n.t("poll.multiple.help.up_to_max_options", { count: max });
      }
    }
  },

  html(attrs) {
    const { poll } = attrs;
    const count = poll.get("voters");
    const contents = [
      h("p", [
        h("span.info-number", count.toString()),
        h("span.info-label", I18n.t("poll.voters", { count })),
      ]),
    ];

    if (attrs.isMultiple) {
      if (attrs.showResults || attrs.isClosed) {
        const totalVotes = poll.get("options").reduce((total, o) => {
          return total + parseInt(o.votes, 10);
        }, 0);

        contents.push(
          h("p", [
            h("span.info-number", totalVotes.toString()),
            h(
              "span.info-label",
              I18n.t("poll.total_votes", { count: totalVotes })
            ),
          ])
        );
      } else {
        const help = this.multipleHelpText(
          attrs.min,
          attrs.max,
          poll.get("options.length")
        );
        if (help) {
          contents.push(infoTextHtml(help));
        }
      }
    }

    if (
      !attrs.isClosed &&
      !attrs.showResults &&
      poll.public &&
      poll.results !== "staff_only"
    ) {
      contents.push(infoTextHtml(I18n.t("poll.public.title")));
    }

    return contents;
  },
});

function clearPieChart(id) {
  let el = document.querySelector(`#poll-results-chart-${id}`);
  el && el.parentNode.removeChild(el);
}

createWidget("discourse-poll-pie-canvas", {
  tagName: "canvas.poll-results-canvas",

  init(attrs) {
    loadScript("/javascripts/Chart.min.js").then(() => {
      const data = attrs.poll.options.mapBy("votes");
      const labels = attrs.poll.options.mapBy("html");
      const config = pieChartConfig(data, labels);

      const el = document.getElementById(`poll-results-chart-${attrs.id}`);
      // eslint-disable-next-line
      let chart = new Chart(el.getContext("2d"), config);
      document.getElementById(
        `poll-results-legend-${attrs.id}`
      ).innerHTML = chart.generateLegend();
    });
  },

  buildAttributes(attrs) {
    return {
      id: `poll-results-chart-${attrs.id}`,
    };
  },
});

createWidget("discourse-poll-pie-chart", {
  tagName: "div.poll-results-chart",

  html(attrs) {
    const contents = [];

    if (!attrs.showResults) {
      clearPieChart(attrs.id);
      return contents;
    }

    const chart = this.attach("discourse-poll-pie-canvas", attrs);
    contents.push(chart);

    contents.push(h(`div#poll-results-legend-${attrs.id}.pie-chart-legends`));

    return contents;
  },
});

function pieChartConfig(data, labels, opts = {}) {
  const aspectRatio = "aspectRatio" in opts ? opts.aspectRatio : 2.2;
  const strippedLabels = labels.map((l) => stripHtml(l));
  return {
    type: PIE_CHART_TYPE,
    data: {
      datasets: [
        {
          data,
          backgroundColor: getColors(data.length),
        },
      ],
      labels: strippedLabels,
    },
    options: {
      responsive: true,
      aspectRatio,
      animation: { duration: 0 },
      legend: { display: false },
      legendCallback: function (chart) {
        let legends = "";
        for (let i = 0; i < labels.length; i++) {
          legends += `<div class="legend"><span class="swatch" style="background-color:
            ${chart.data.datasets[0].backgroundColor[i]}"></span>${labels[i]}</div>`;
        }
        return legends;
      },
    },
  };
}

function stripHtml(html) {
  let doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

createWidget("discourse-poll-buttons", {
  tagName: "div.poll-buttons",

  html(attrs) {
    const contents = [];
    const { poll, post } = attrs;
    const topicArchived = post.get("topic.archived");
    const closed = attrs.isClosed;
    const staffOnly = poll.results === "staff_only";
    const isStaff = this.currentUser && this.currentUser.staff;
    const isAdmin = this.currentUser && this.currentUser.admin;
    const isMe = this.currentUser && post.user_id === this.currentUser.id;
    const dataExplorerEnabled = this.siteSettings.data_explorer_enabled;
    const hideResultsDisabled = !staffOnly && (closed || topicArchived);
    const exportQueryID = this.siteSettings.poll_export_data_explorer_query_id;

    if (attrs.isMultiple && !hideResultsDisabled) {
      const castVotesDisabled = !attrs.canCastVotes;
      contents.push(
        this.attach("button", {
          className: `cast-votes ${
            castVotesDisabled ? "btn-default" : "btn-primary"
          }`,
          label: "poll.cast-votes.label",
          title: "poll.cast-votes.title",
          disabled: castVotesDisabled,
          action: "castVotes",
        })
      );
      contents.push(" ");
    }

    if (attrs.showResults || hideResultsDisabled) {
      contents.push(
        this.attach("button", {
          className: "btn-default toggle-results",
          label: "poll.hide-results.label",
          title: "poll.hide-results.title",
          icon: "far-eye-slash",
          disabled: hideResultsDisabled,
          action: "toggleResults",
        })
      );
    } else {
      if (poll.get("results") === "on_vote" && !attrs.hasVoted && !isMe) {
        contents.push(infoTextHtml(I18n.t("poll.results.vote.title")));
      } else if (poll.get("results") === "on_close" && !closed) {
        contents.push(infoTextHtml(I18n.t("poll.results.closed.title")));
      } else if (poll.results === "staff_only" && !isStaff) {
        contents.push(infoTextHtml(I18n.t("poll.results.staff.title")));
      } else {
        contents.push(
          this.attach("button", {
            className: "btn-default toggle-results",
            label: "poll.show-results.label",
            title: "poll.show-results.title",
            icon: "far-eye",
            disabled: poll.get("voters") === 0,
            action: "toggleResults",
          })
        );
      }
    }

    if (attrs.groupableUserFields.length && poll.voters > 0) {
      const button = this.attach("button", {
        className: "btn-default poll-show-breakdown",
        label: "poll.group-results.label",
        title: "poll.group-results.title",
        icon: "far-eye",
        action: "showBreakdown",
      });

      contents.push(button);
    }

    if (isAdmin && dataExplorerEnabled && poll.voters > 0 && exportQueryID) {
      contents.push(
        this.attach("button", {
          className: "btn btn-default export-results",
          label: "poll.export-results.label",
          title: "poll.export-results.title",
          icon: "download",
          disabled: poll.voters === 0,
          action: "exportResults",
        })
      );
    }

    if (poll.get("close")) {
      const closeDate = moment(poll.get("close"));
      if (closeDate.isValid()) {
        const title = closeDate.format("LLL");
        let label;

        if (attrs.isAutomaticallyClosed) {
          const age = relativeAge(closeDate.toDate(), { addAgo: true });
          label = I18n.t("poll.automatic_close.age", { age });
        } else {
          const timeLeft = moment().to(closeDate, true);
          label = I18n.t("poll.automatic_close.closes_in", { timeLeft });
        }

        contents.push(
          new RawHtml({
            html: `<span class="info-text" title="${title}">${label}</span>`,
          })
        );
      }
    }

    if (
      this.currentUser &&
      (this.currentUser.get("id") === post.get("user_id") || isStaff) &&
      !topicArchived
    ) {
      if (closed) {
        if (!attrs.isAutomaticallyClosed) {
          contents.push(
            this.attach("button", {
              className: "btn-default toggle-status",
              label: "poll.open.label",
              title: "poll.open.title",
              icon: "unlock-alt",
              action: "toggleStatus",
            })
          );
        }
      } else {
        contents.push(
          this.attach("button", {
            className: "toggle-status btn-danger",
            label: "poll.close.label",
            title: "poll.close.title",
            icon: "lock",
            action: "toggleStatus",
          })
        );
      }
    }

    return contents;
  },
});

export default createWidget("discourse-poll", {
  tagName: "div",
  buildKey: (attrs) => `poll-${attrs.id}`,

  buildAttributes(attrs) {
    let cssClasses = "poll";
    if (attrs.poll.chart_type === PIE_CHART_TYPE) {
      cssClasses += " pie";
    }
    return {
      class: cssClasses,
      "data-poll-name": attrs.poll.get("name"),
      "data-poll-type": attrs.poll.get("type"),
    };
  },

  defaultState(attrs) {
    const { post, poll } = attrs;
    const staffOnly = attrs.poll.results === "staff_only";

    const showResults =
      (post.get("topic.archived") && !staffOnly) ||
      (this.isClosed() && !staffOnly) ||
      (poll.results !== "on_close" && this.hasVoted() && !staffOnly);

    return { loading: false, showResults };
  },

  html(attrs, state) {
    const staffOnly = attrs.poll.results === "staff_only";
    const showResults =
      state.showResults ||
      (attrs.post.get("topic.archived") && !staffOnly) ||
      (this.isClosed() && !staffOnly);

    const newAttrs = jQuery.extend({}, attrs, {
      canCastVotes: this.canCastVotes(),
      hasVoted: this.hasVoted(),
      isAutomaticallyClosed: this.isAutomaticallyClosed(),
      isClosed: this.isClosed(),
      isMultiple: this.isMultiple(),
      max: this.max(),
      min: this.min(),
      showResults,
    });

    return h("div", [
      this.attach("discourse-poll-container", newAttrs),
      this.attach("discourse-poll-info", newAttrs),
      this.attach("discourse-poll-buttons", newAttrs),
    ]);
  },

  min() {
    let min = parseInt(this.attrs.poll.get("min"), 10);
    if (isNaN(min) || min < 0) {
      min = 0;
    }
    return min;
  },

  max() {
    let max = parseInt(this.attrs.poll.get("max"), 10);
    const numOptions = this.attrs.poll.get("options.length");
    if (isNaN(max) || max > numOptions) {
      max = numOptions;
    }
    return max;
  },

  isAutomaticallyClosed() {
    const { poll } = this.attrs;
    return poll.get("close") && moment.utc(poll.get("close")) <= moment();
  },

  isClosed() {
    const { poll } = this.attrs;
    return poll.get("status") === "closed" || this.isAutomaticallyClosed();
  },

  isMultiple() {
    const { poll } = this.attrs;
    return poll.get("type") === "multiple";
  },

  hasVoted() {
    const { vote } = this.attrs;
    return vote && vote.length > 0;
  },

  canCastVotes() {
    const { state, attrs } = this;

    if (this.isClosed() || state.showResults || state.loading) {
      return false;
    }

    const selectedOptionCount = attrs.vote.length;

    if (this.isMultiple()) {
      return (
        selectedOptionCount >= this.min() && selectedOptionCount <= this.max()
      );
    }

    return selectedOptionCount > 0;
  },

  toggleStatus() {
    const { state, attrs } = this;
    const { post, poll } = attrs;

    if (this.isAutomaticallyClosed()) {
      return;
    }

    bootbox.confirm(
      I18n.t(this.isClosed() ? "poll.open.confirm" : "poll.close.confirm"),
      I18n.t("no_value"),
      I18n.t("yes_value"),
      (confirmed) => {
        if (confirmed) {
          state.loading = true;
          const status = this.isClosed() ? "open" : "closed";

          ajax("/polls/toggle_status", {
            type: "PUT",
            data: {
              post_id: post.get("id"),
              poll_name: poll.get("name"),
              status,
            },
          })
            .then(() => {
              poll.set("status", status);
              if (poll.get("results") === "on_close") {
                state.showResults = status === "closed";
              }
              this.scheduleRerender();
            })
            .catch((error) => {
              if (error) {
                popupAjaxError(error);
              } else {
                bootbox.alert(I18n.t("poll.error_while_toggling_status"));
              }
            })
            .finally(() => {
              state.loading = false;
            });
        }
      }
    );
  },

  toggleResults() {
    this.state.showResults = !this.state.showResults;
  },

  exportResults() {
    const { attrs } = this;
    const queryID = this.siteSettings.poll_export_data_explorer_query_id;

    // This uses the Data Explorer plugin export as CSV route
    // There is detection to check if the plugin is enabled before showing the button
    ajax(`/admin/plugins/explorer/queries/${queryID}/run.csv`, {
      type: "POST",
      data: {
        // needed for data-explorer route compatibility
        params: JSON.stringify({
          poll_name: attrs.poll.name,
          post_id: attrs.post.id.toString(), // needed for data-explorer route compatibility
        }),
        explain: false,
        limit: 1000000,
        download: 1,
      },
    })
      .then((csvContent) => {
        const downloadLink = document.createElement("a");
        const blob = new Blob([csvContent], {
          type: "text/csv;charset=utf-8;",
        });
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.setAttribute(
          "download",
          `poll-export-${attrs.poll.name}-${attrs.post.id}.csv`
        );
        downloadLink.click();
        downloadLink.remove();
      })
      .catch((error) => {
        if (error) {
          popupAjaxError(error);
        } else {
          bootbox.alert(I18n.t("poll.error_while_exporting_results"));
        }
      });
  },

  showLogin() {
    this.register.lookup("route:application").send("showLogin");
  },

  _toggleOption(option) {
    const { vote } = this.attrs;
    const chosenIdx = vote.indexOf(option.id);
    if (chosenIdx !== -1) {
      vote.splice(chosenIdx, 1);
    } else {
      vote.push(option.id);
    }
  },

  toggleOption(option) {
    const { attrs } = this;

    if (this.isClosed()) {
      return;
    }
    if (!this.currentUser) {
      return this.showLogin();
    }
    if (!checkUserGroups(this.currentUser, this.attrs.poll)) {
      return;
    }

    const { vote } = attrs;
    if (!this.isMultiple()) {
      vote.length = 0;
    }

    this._toggleOption(option);
    if (!this.isMultiple()) {
      return this.castVotes().catch(() => this._toggleOption(option));
    }
  },

  castVotes() {
    if (!this.canCastVotes()) {
      return;
    }
    if (!this.currentUser) {
      return this.showLogin();
    }

    const { attrs, state } = this;

    state.loading = true;

    return ajax("/polls/vote", {
      type: "PUT",
      data: {
        post_id: attrs.post.id,
        poll_name: attrs.poll.get("name"),
        options: attrs.vote,
      },
    })
      .then(({ poll }) => {
        attrs.poll.setProperties(poll);
        this.appEvents.trigger("poll:voted", poll, attrs.post, attrs.vote);

        if (attrs.poll.get("results") !== "on_close") {
          state.showResults = true;
        }
        if (attrs.poll.results === "staff_only") {
          if (this.currentUser && this.currentUser.get("staff")) {
            state.showResults = true;
          } else {
            state.showResults = false;
          }
        }
      })
      .catch((error) => {
        if (error) {
          popupAjaxError(error);
        } else {
          bootbox.alert(I18n.t("poll.error_while_casting_votes"));
        }
      })
      .finally(() => {
        state.loading = false;
      });
  },

  showBreakdown() {
    showModal("poll-breakdown", {
      model: this.attrs,
      panels: [
        { id: "percentage", title: "poll.breakdown.percentage" },
        { id: "count", title: "poll.breakdown.count" },
      ],
    });
  },
});
