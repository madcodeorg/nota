import { css } from '@emotion/css';
import { html, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import {
  createUniComponentFromWebComponent,
  renderUniLit,
} from '../../core/utils/uni-component/uni-component.js';
import { DataViewUIBase } from '../../core/view/data-view-base.js';
import { CardViewUILogic } from '../card-view-ui.js';
import type { GallerySingleView } from './gallery-view-manager.js';
import { galleryImageSource } from './image-utils.js';

export class GalleryViewUILogic extends CardViewUILogic<GallerySingleView> {
  renderer = createUniComponentFromWebComponent(GalleryViewUI);
}

export class GalleryViewUI extends DataViewUIBase<GalleryViewUILogic> {
  override connectedCallback(): void {
    super.connectedCallback();
    this.logic.ui$.value = this;
    this.classList.add(galleryStyle);
  }

  override disconnectedCallback(): void {
    if (this.logic.ui$.value === this) this.logic.ui$.value = undefined;
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    const view = this.logic.view;
    const imageProperty = view.imageProperty$.value;
    const titleProperty = view.mainProperties$.value.titleColumn;
    const readonly = view.readonly$.value;
    const cardProperties = view.properties$.value.filter(
      property =>
        property.id !== titleProperty && property.id !== imageProperty?.id
    );
    return html`
      ${renderUniLit(this.logic.headerWidget, { dataViewLogic: this.logic })}
      <div class="gallery-toolbar">
        <label
          >Card cover
          <select
            aria-label="Gallery image property"
            .value=${imageProperty?.id ?? ''}
            ?disabled=${readonly}
            @change=${(event: Event) =>
              view.imageColumnSet(
                (event.target as HTMLSelectElement).value || undefined
              )}
          >
            <option value="" .selected=${!imageProperty}>No cover</option>
            ${view.imageProperties$.value.map(
              property =>
                html`<option
                  value=${property.id}
                  .selected=${property.id === imageProperty?.id}
                >
                  ${property.name$.value}
                </option>`
            )}
          </select>
        </label>
        <details>
          <summary>Card properties</summary>
          ${view.detailProperties$.value.map(
            property =>
              html`<label class="gallery-property-option"
                ><input
                  type="checkbox"
                  .checked=${!property.hide$.value}
                  ?disabled=${readonly || !property.hideCanSet}
                  @change=${(event: Event) =>
                    property.hideSet(
                      !(event.target as HTMLInputElement).checked
                    )}
                />${property.name$.value}</label
              >`
          )}
        </details>
      </div>
      <div class="gallery-cards" role="list" aria-label="Database rows">
        ${repeat(
          view.rows$.value,
          row => row.rowId,
          row => {
            const image = imageProperty
              ? galleryImageSource(
                  imageProperty.cellGetOrCreate(row.rowId).value$.value
                )
              : undefined;
            return html`<article role="listitem">
              <button
                class="gallery-card"
                data-row-id=${row.rowId}
                aria-label=${`Open ${view.titleGet(row.rowId)}`}
                @click=${(event: MouseEvent) => {
                  event.stopPropagation();
                  this.logic.openRow(row.rowId);
                }}
              >
                ${image
                  ? html`<img
                      class="gallery-cover"
                      src=${image}
                      alt=""
                      loading="lazy"
                      referrerpolicy="no-referrer"
                    />`
                  : ''}
                <strong class="gallery-title"
                  >${view.titleGet(row.rowId)}</strong
                >
                ${cardProperties.map(
                  property =>
                    html`<span class="gallery-property"
                      ><span class="gallery-property-name"
                        >${property.name$.value}</span
                      ><span
                        >${property.cellGetOrCreate(row.rowId).stringValue$
                          .value ?? ''}</span
                      ></span
                    >`
                )}
              </button>
            </article>`;
          }
        )}
      </div>
      ${view.rows$.value.length === 0
        ? html`<p>No rows match this view.</p>`
        : ''}
    `;
  }
}

export function galleryEffects() {
  customElements.define('dv-gallery-view-ui', GalleryViewUI);
}

const galleryStyle = css({
  display: 'block',
  color: 'var(--affine-text-primary-color)',
  '.gallery-toolbar': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    flexWrap: 'wrap',
    margin: '12px 0',
  },
  '.gallery-toolbar label': {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  '.gallery-property-option': { marginTop: '6px' },
  '.gallery-toolbar select': {
    color: 'inherit',
    background: 'var(--affine-background-secondary-color)',
    border: '1px solid var(--affine-border-color)',
    borderRadius: '4px',
    font: 'inherit',
    padding: '4px 8px',
  },
  summary: { cursor: 'pointer', padding: '4px 0' },
  '.gallery-cards': {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
    gap: '16px',
  },
  '.gallery-card': {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    padding: 0,
    textAlign: 'left',
    font: 'inherit',
    color: 'inherit',
    background: 'var(--affine-background-primary-color)',
    border: '1px solid var(--affine-border-color)',
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'pointer',
  },
  '.gallery-card:hover': { background: 'var(--affine-hover-color)' },
  '.gallery-card:focus-visible, select:focus-visible, summary:focus-visible': {
    outline: '2px solid var(--affine-primary-color)',
    outlineOffset: '2px',
  },
  '.gallery-cover': {
    width: '100%',
    height: '140px',
    objectFit: 'cover',
    background: 'var(--affine-background-secondary-color)',
  },
  '.gallery-title': { padding: '12px', overflowWrap: 'anywhere' },
  '.gallery-property': {
    display: 'flex',
    gap: '8px',
    padding: '0 12px 8px',
    width: '100%',
    overflowWrap: 'anywhere',
  },
  '.gallery-property-name': {
    color: 'var(--affine-text-secondary-color)',
    minWidth: '64px',
    maxWidth: '40%',
  },
});

declare global {
  interface HTMLElementTagNameMap {
    'dv-gallery-view-ui': GalleryViewUI;
  }
}
