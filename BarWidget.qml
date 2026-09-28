import QtQuick
import qs.Ui

// The bar button: a launcher for the overlay, for anyone who would rather
// click than use the hotkey.
BarWidget {
  id: root
  moduleName: "forcey.reckon"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰃬"
    tooltipText: "Reckon"
    onPressed: function(button) {
      if (root.bar) root.bar.run("omarchy-shell shell toggle forcey.reckon")
    }
  }
}
