import { createNodeApp } from "@rezi-ui/node";
import { initialState } from "./helpers/actions";
import { registerKeybindings } from "./helpers/keybindings";
import { mainScreen } from "./screens/main";
import { themes } from "./theme";
import type { State } from "./types";

const app = createNodeApp<State>({
  initialState,
  theme: themes.default,
});

app.view(mainScreen(app));
registerKeybindings(app);

await app.run();
