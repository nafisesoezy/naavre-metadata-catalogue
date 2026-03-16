import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

/**
 * Initialization data for the LTER-LIFE-metadata-catalogue extension.
 */
function createCatalogueWidget(): Widget {
  const widget = new Widget();
  widget.id = 'LTER-LIFE-catalogue-panel';
  widget.title.label = 'Catalogue';
  widget.title.closable = true;

  const container = document.createElement('div');
  container.style.padding = '20px';

  const title = document.createElement('h2');
  title.innerText = 'LTER-LIFE Metadata Catalogue';

  const input = document.createElement('input');
  input.placeholder = 'Search catalogue...';
  input.style.marginRight = '10px';
  input.style.padding = '6px';

  const button = document.createElement('button');
  button.innerText = 'Search';

  const results = document.createElement('div');
  results.style.marginTop = '20px';

  button.onclick = () => {
    results.innerHTML =
      '<p>Fake result 1</p><p>Fake dataset 2</p><p>Fake dataset 3</p>';
  };

  container.appendChild(title);
  container.appendChild(input);
  container.appendChild(button);
  container.appendChild(results);

  widget.node.appendChild(container);
  return widget;
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'LTER-LIFE-metadata-catalogue:plugin',
  description: 'A JupyterLab extension.',
  autoStart: true,
  optional: [ISettingRegistry],
  requires: [ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    settingRegistry: ISettingRegistry | null
  ) => {
    console.log('JupyterLab extension LTERLIFE-metadata-catalogue is activated!');
    const { commands, shell } = app;
    const command = 'catalogue:open';

    commands.addCommand(command, {
      label: 'Open LTER-LIFE Metadata Catalogue',
      execute: () => {
        const widget = createCatalogueWidget();
        shell.add(widget, 'main');
      }
    });

    palette.addItem({
      command,
      category: 'NaaVRE'
    });
    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log('LTERLIFE-metadata-catalogue settings loaded:', settings.composite);
        })
        .catch(reason => {
          console.error('Failed to load settings for LTERLIFE-metadata-catalogue.', reason);
        });
    }
  }
};

export default plugin;
