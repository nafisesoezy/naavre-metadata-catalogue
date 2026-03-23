import { ICommandPalette } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
function createCatalogueWidget(metadataCatalogueUrl) {
    const pageSize = 10;
    let currentPage = 1;
    let totalPages = 0;
    let currentQuery = '';
    const basket = [];
    const widget = new Widget();
    widget.id = 'LTER-LIFE-catalogue-panel';
    widget.title.label = 'Catalogue';
    widget.title.closable = true;
    widget.node.style.height = '100%';
    widget.node.style.display = 'flex';
    widget.node.style.flexDirection = 'column';
    widget.node.style.overflow = 'hidden';
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.flex = '1';
    container.style.minHeight = '0';
    container.style.padding = '24px';
    container.style.boxSizing = 'border-box';
    container.style.fontFamily = 'Arial, sans-serif';
    container.style.lineHeight = '1.5';
    container.style.maxWidth = '1100px';
    container.style.overflow = 'hidden';
    const heading = document.createElement('h2');
    heading.innerText = 'LTER-LIFE Metadata Catalogue';
    heading.style.margin = '0 0 16px 0';
    heading.style.fontSize = '22px';
    heading.style.fontWeight = '600';
    heading.style.color = '#202124';
    const searchBar = document.createElement('div');
    searchBar.style.display = 'flex';
    searchBar.style.alignItems = 'center';
    searchBar.style.gap = '10px';
    searchBar.style.marginBottom = '18px';
    searchBar.style.flexWrap = 'wrap';
    const input = document.createElement('input');
    input.placeholder = 'Search catalogue...';
    input.style.width = '420px';
    input.style.maxWidth = '100%';
    input.style.padding = '10px 12px';
    input.style.fontSize = '15px';
    input.style.border = '1px solid #d0d7de';
    input.style.borderRadius = '6px';
    input.style.outline = 'none';
    const searchButton = document.createElement('button');
    searchButton.innerText = 'Search';
    searchButton.style.padding = '10px 16px';
    searchButton.style.fontSize = '15px';
    searchButton.style.border = '1px solid #d0d7de';
    searchButton.style.borderRadius = '6px';
    searchButton.style.cursor = 'pointer';
    searchButton.style.background = '#f6f8fa';
    const basketPanel = document.createElement('div');
    basketPanel.style.marginBottom = '18px';
    basketPanel.style.padding = '14px 16px';
    basketPanel.style.border = '1px solid #dadce0';
    basketPanel.style.borderRadius = '8px';
    basketPanel.style.background = '#f8f9fa';
    const resultsInfo = document.createElement('div');
    resultsInfo.style.marginBottom = '14px';
    resultsInfo.style.color = '#5f6368';
    resultsInfo.style.fontSize = '15px';
    const paginationBar = document.createElement('div');
    paginationBar.style.display = 'none';
    paginationBar.style.alignItems = 'center';
    paginationBar.style.gap = '12px';
    paginationBar.style.marginBottom = '14px';
    paginationBar.style.flexWrap = 'wrap';
    const previousButton = document.createElement('button');
    previousButton.innerText = 'Previous';
    previousButton.style.padding = '8px 14px';
    previousButton.style.fontSize = '14px';
    previousButton.style.border = '1px solid #d0d7de';
    previousButton.style.borderRadius = '6px';
    previousButton.style.cursor = 'pointer';
    previousButton.style.background = '#f6f8fa';
    const nextButton = document.createElement('button');
    nextButton.innerText = 'Next';
    nextButton.style.padding = '8px 14px';
    nextButton.style.fontSize = '14px';
    nextButton.style.border = '1px solid #d0d7de';
    nextButton.style.borderRadius = '6px';
    nextButton.style.cursor = 'pointer';
    nextButton.style.background = '#f6f8fa';
    const pageInfo = document.createElement('span');
    pageInfo.style.color = '#5f6368';
    pageInfo.style.fontSize = '14px';
    paginationBar.appendChild(previousButton);
    paginationBar.appendChild(nextButton);
    paginationBar.appendChild(pageInfo);
    const results = document.createElement('div');
    results.style.flex = '1';
    results.style.minHeight = '0';
    results.style.overflowY = 'auto';
    results.style.marginTop = '4px';
    results.style.paddingRight = '4px';
    function escapeHtml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function createBasketIcon() {
        return `
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M7 10L12 4L17 10"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M5 10H19L17.5 20H6.5L5 10Z"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
    `;
    }
    function updateBasketUI() {
        if (basket.length === 0) {
            basketPanel.innerHTML = `
        <div style="font-size:16px; font-weight:600; color:#202124; margin-bottom:6px;">
          🧺 Basket
        </div>
        <div style="font-size:14px; color:#5f6368;">
          No records added yet.
        </div>
      `;
            return;
        }
        basketPanel.innerHTML = `
      <div style="font-size:16px; font-weight:600; color:#202124; margin-bottom:8px;">
        🧺 Basket (${basket.length})
      </div>
      <ul style="margin:0; padding-left:18px;">
        ${basket
            .map(item => `
              <li style="margin-bottom:6px;">
                <a
                  href="${escapeHtml(item.link)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  style="color:#1a0dab; text-decoration:none;"
                  onmouseover="this.style.textDecoration='underline'"
                  onmouseout="this.style.textDecoration='none'"
                >
                  ${escapeHtml(item.title)}
                </a>
              </li>
            `)
            .join('')}
      </ul>
    `;
    }
    function addToBasket(item) {
        const exists = basket.some(existing => existing.uuid === item.uuid);
        if (exists) {
            return false;
        }
        basket.push(item);
        updateBasketUI();
        return true;
    }
    function updatePaginationUI() {
        if (totalPages <= 1) {
            paginationBar.style.display = 'none';
            return;
        }
        paginationBar.style.display = 'flex';
        previousButton.disabled = currentPage <= 1;
        nextButton.disabled = currentPage >= totalPages;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    }
    function getRecordTitle(src) {
        var _a;
        return ((src === null || src === void 0 ? void 0 : src.title) ||
            ((_a = src === null || src === void 0 ? void 0 : src.resourceTitleObject) === null || _a === void 0 ? void 0 : _a.default) ||
            'Untitled record');
    }
    function getRecordOrganisation(src) {
        var _a;
        return ((src === null || src === void 0 ? void 0 : src.organisation) ||
            ((_a = src === null || src === void 0 ? void 0 : src.orgNameObject) === null || _a === void 0 ? void 0 : _a.default) ||
            (src === null || src === void 0 ? void 0 : src.owner) ||
            (src === null || src === void 0 ? void 0 : src.contact) ||
            '');
    }
    function renderResults(hits) {
        results.innerHTML = '';
        hits.forEach((hit) => {
            const src = (hit === null || hit === void 0 ? void 0 : hit._source) || {};
            const recordTitle = getRecordTitle(src);
            const uuid = (src === null || src === void 0 ? void 0 : src.uuid) || '';
            const organisation = getRecordOrganisation(src);
            const showOrganisation = organisation && !/^\d+$/.test(String(organisation).trim());
            const link = `https://lter-life-catalogue.qcdis.org/geonetwork/srv/eng/catalog.search#/metadata/${uuid}`;
            const card = document.createElement('div');
            card.style.padding = '0 0 14px 0';
            card.style.marginBottom = '18px';
            card.style.borderBottom = '1px solid #e0e0e0';
            const metadataLine = `
          <div style="color:#5f6368; font-size:12px; margin:4px 0 6px 0;">
            UUID: ${escapeHtml(uuid || 'N/A')}
          </div>
          ${showOrganisation
                ? `
              <div style="color:#188038; font-size:12px; margin:2px 0 6px 0;">
                ${escapeHtml(organisation)}
              </div>
            `
                : ''}
        `;
            card.innerHTML = `
          <div style="margin-bottom:6px;">
            <a
              href="${escapeHtml(link)}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                color:#1a0dab;
                text-decoration:none;
                font-size:18px;
                font-weight:500;
                line-height:1.25;
              "
              onmouseover="this.style.textDecoration='underline'"
              onmouseout="this.style.textDecoration='none'"
            >
              ${escapeHtml(recordTitle)}
            </a>
          </div>
    
          ${metadataLine}
    
          <div
            style="
              display:flex;
              align-items:center;
              gap:18px;
              flex-wrap:wrap;
              margin-top:6px;
            "
          >
            <button
              class="basket-btn"
              type="button"
              style="
                background:none;
                border:none;
                color:#1a0dab;
                font-size:13px;
                cursor:pointer;
                padding:0;
                display:inline-flex;
                align-items:center;
                gap:6px;
              "
            >
              ${createBasketIcon()}
              <span>Add to basket</span>
            </button>
    
            <a
              href="${escapeHtml(link)}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                color:#1a0dab;
                text-decoration:none;
                font-size:13px;
              "
              onmouseover="this.style.textDecoration='underline'"
              onmouseout="this.style.textDecoration='none'"
            >
              View record
            </a>
          </div>
        `;
            results.appendChild(card);
            const basketButton = card.querySelector('.basket-btn');
            basketButton.onclick = () => {
                const added = addToBasket({
                    uuid,
                    title: recordTitle,
                    link
                });
                if (added) {
                    basketButton.innerHTML = `
              <span style="font-size:14px;">✅</span>
              <span>Added to basket</span>
            `;
                    basketButton.disabled = true;
                    basketButton.style.color = '#188038';
                    basketButton.style.cursor = 'default';
                }
            };
        });
    }
    async function runSearch(resetPage = false) {
        var _a;
        if (resetPage) {
            currentPage = 1;
            currentQuery = input.value.trim();
        }
        resultsInfo.innerHTML = '';
        results.innerHTML = '<p style="color:#5f6368;">Searching...</p>';
        paginationBar.style.display = 'none';
        if (!currentQuery) {
            results.innerHTML =
                '<p style="color:#d93025;">Please enter a search term.</p>';
            return;
        }
        if (!metadataCatalogueUrl) {
            results.innerHTML =
                '<p style="color:#d93025;">Metadata catalogue URL is not configured.</p>';
            return;
        }
        try {
            const searchUrl = `${metadataCatalogueUrl.replace(/\/$/, '')}/search`;
            const response = await fetch(searchUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify({
                    query: currentQuery,
                    page: currentPage,
                    size: pageSize
                })
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status} ${response.statusText}: ${text}`);
            }
            const data = await response.json();
            const hits = ((_a = data === null || data === void 0 ? void 0 : data.hits) === null || _a === void 0 ? void 0 : _a.hits) || [];
            const total = (data === null || data === void 0 ? void 0 : data.total) || 0;
            totalPages = (data === null || data === void 0 ? void 0 : data.total_pages) || 0;
            if (hits.length === 0) {
                resultsInfo.innerHTML = 'No results found.';
                results.innerHTML = '';
                return;
            }
            resultsInfo.innerHTML = `About ${total} result${total === 1 ? '' : 's'}`;
            renderResults(hits);
            updatePaginationUI();
        }
        catch (err) {
            console.error('Search error:', err);
            resultsInfo.innerHTML = '';
            results.innerHTML = `
        <p style="color:#d93025;">
          Error while searching: ${escapeHtml(String((err === null || err === void 0 ? void 0 : err.message) || err))}
        </p>
      `;
            paginationBar.style.display = 'none';
        }
    }
    searchButton.onclick = () => {
        void runSearch(true);
    };
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            void runSearch(true);
        }
    });
    previousButton.onclick = () => {
        if (currentPage > 1) {
            currentPage -= 1;
            void runSearch(false);
        }
    };
    nextButton.onclick = () => {
        if (currentPage < totalPages) {
            currentPage += 1;
            void runSearch(false);
        }
    };
    updateBasketUI();
    searchBar.appendChild(input);
    searchBar.appendChild(searchButton);
    container.appendChild(heading);
    container.appendChild(searchBar);
    container.appendChild(basketPanel);
    container.appendChild(resultsInfo);
    container.appendChild(paginationBar);
    container.appendChild(results);
    widget.node.appendChild(container);
    return widget;
}
const plugin = {
    id: 'naavre-metadata-catalogue-jupyterlab:plugin',
    description: 'LTER-LIFE metadata catalogue search panel for JupyterLab.',
    autoStart: true,
    optional: [ISettingRegistry],
    requires: [ICommandPalette],
    activate: (app, palette, settingRegistry) => {
        console.log('JupyterLab extension LTER-LIFE-metadata-catalogue is activated.');
        const { commands, shell } = app;
        const command = 'catalogue:open';
        commands.addCommand(command, {
            label: 'Open LTER-LIFE Metadata Catalogue',
            execute: async () => {
                let metadataCatalogueUrl = '';
                if (settingRegistry) {
                    try {
                        const settings = await settingRegistry.load(plugin.id);
                        metadataCatalogueUrl =
                            settings.get('metadataCatalogueUrl').composite || '';
                    }
                    catch (reason) {
                        console.error('Failed to load metadataCatalogueUrl setting.', reason);
                    }
                }
                const widget = createCatalogueWidget(metadataCatalogueUrl);
                shell.add(widget, 'main');
                shell.activateById(widget.id);
            }
        });
        palette.addItem({
            command,
            category: 'NaaVRE'
        });
        if (settingRegistry) {
            void settingRegistry
                .load(plugin.id)
                .then(settings => {
                console.log('LTER-LIFE-metadata-catalogue settings loaded:', settings.composite);
            })
                .catch(reason => {
                console.error('Failed to load settings for LTER-LIFE-metadata-catalogue.', reason);
            });
        }
    }
};
export default plugin;
//# sourceMappingURL=index.js.map