// Forwards keyboard/mouse events so Beekeeper's shortcuts keep working while the plugin has focus.
import "@beekeeperstudio/plugin/dist/eventForwarder";
import { createApp } from "vue";
import App from "./App.vue";
import "./styles/app.css";

createApp(App).mount("#app");
