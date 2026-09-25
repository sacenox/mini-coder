# Harness helpers for the ux-walk. Source from the run dir.
RUN=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
S=uxw
APP=/home/xonecas/src/agents/mini-coder/src/cli.ts

geo() { tmux display -p 'pane=#{pane_width}x#{pane_height} win=#{window_width}x#{window_height} client=#{client_width}x#{client_height}'; }
size() { tmux resize-window -t $S -x "$1" -y "$2"; sleep 0.4; }
cap() { tmux capture-pane -p -e -t $S -S - > "$RUN/captures/$1"; echo "captures/$1"; }
shot() { spectacle -a -b -n -o "$RUN/shots/$1" >/dev/null 2>&1; sleep 0.5; identify "$RUN/shots/$1" | sed 's/ PNG.*//'; }
lit() { tmux send-keys -t $S -l "$1"; }
key() { tmux send-keys -t $S "$@"; }
app() { lit "script -q -O $1 -c 'node $APP'"; key Enter; }
find_session() { ls -t "$RUN/sessions" | head -1; }
lastlog() { ls -t "$RUN"/*.log | head -1; }
# burst <name> <frames> <ms>: rapid pane captures to catch short-lived phases.
burst() { local n="$1" c="$2" d="$3"; : > "$RUN/captures/$n"; for i in $(seq "$c"); do { echo "--- frame $i"; tmux capture-pane -p -t $S; } >> "$RUN/captures/$n"; sleep "$(awk "BEGIN{print $d/1000}")"; done; echo "captures/$n"; }
status() { tmux capture-pane -p -t $S | tail -1; }
relaunch() { pkill -x kitty; sleep 0.4; setsid kitty --detach --title uxw-walk -o remember_window_size=no -o initial_window_width=$1c -o initial_window_height=$2c tmux attach -t uxw >/dev/null 2>&1; sleep 2; size "$1" "$2"; geo; }
