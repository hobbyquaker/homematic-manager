/* jshint forin:true, noarg:true, noempty:true, eqeqeq:true, boss:true, undef:true, curly:true, browser:true, jquery:true */
/*
 * jQuery MultiSelect UI Widget Filtering Plugin 1.5pre
 * Copyright (c) 2012 Eric Hynds
 *
 * http://www.erichynds.com/jquery/jquery-ui-multiselect-widget/
 *
 * Depends:
 *   - jQuery UI MultiSelect widget
 *
 * Dual licensed under the MIT and GPL licenses:
 *   http://www.opensource.org/licenses/mit-license.php
 *   http://www.gnu.org/licenses/gpl.html
 *
 */
(function ($) {
    const rEscape = /[\-\[\]{}()*+?.,\\\^$|#\s]/g;

    $.widget('ech.multiselectfilter', {

        options: {
            label: 'Filter:',
            width: null, /* Override default width set in css file (px). null will inherit */
            placeholder: 'Enter keywords',
            autoReset: false
        },

        _create() {
            const opts = this.options;
            const elem = $(this.element);

      // Get the multiselect instance
            const instance = (this.instance = (elem.data('echMultiselect') || elem.data('multiselect') || elem.data('ech-multiselect')));

      // Store header; add filter class so the close/check all/uncheck all links can be positioned correctly
            const header = (this.header = instance.menu.find('.ui-multiselect-header').addClass('ui-multiselect-hasfilter'));

      // Wrapper elem
            const wrapper = (this.wrapper = $('<div class="ui-multiselect-filter">' + (opts.label.length ? opts.label : '') + '<input placeholder="' + opts.placeholder + '" type="search"' + (/\d/.test(opts.width) ? 'style="width:' + opts.width + 'px"' : '') + ' /></div>').prependTo(this.header));

      // Reference to the actual inputs
            this.inputs = instance.menu.find('input[type="checkbox"], input[type="radio"]');

      // Build the input box
            this.input = wrapper.find('input').bind({
                keydown(e) {
          // Prevent the enter key from submitting the form / closing the widget
                    if (e.which === 13) {
                        e.preventDefault();
                    }
                },
                keyup: $.proxy(this._handler, this),
                click: $.proxy(this._handler, this)
            });

      // Cache input values for searching
            this.updateCache();

      // Rewrite internal _toggleChecked fn so that when checkAll/uncheckAll is fired,
      // only the currently filtered elements are checked
            instance._toggleChecked = function (flag, group) {
                let $inputs = (group && group.length) ? group : this.labels.find('input');
                const _self = this;

        // Do not include hidden elems if the menu isn't open.
                const selector = instance._isOpen ? ':disabled, :hidden' : ':disabled';

                $inputs = $inputs
          .not(selector)
          .each(this._toggleState('checked', flag));

        // Update text
                this.update();

        // Gather an array of the values that actually changed
                const values = $inputs.map(function () {
                    return this.value;
                }).get();

        // Select option tags
                this.element.find('option').filter(function () {
                    if (!this.disabled && $.inArray(this.value, values) > -1) {
                        _self._toggleState('selected', flag).call(this);
                    }
                });

        // Trigger the change event on the select
                if ($inputs.length) {
                    this.element.trigger('change');
                }
            };

      // Rebuild cache when multiselect is updated
            const doc = $(document).bind('multiselectrefresh', $.proxy(function () {
                this.updateCache();
                this._handler();
            }, this));

      // Automatically reset the widget on close?
            if (this.options.autoReset) {
                doc.bind('multiselectclose', $.proxy(this._reset, this));
            }
        },

    // Thx for the logic here ben alman
        _handler(e) {
            let term = $.trim(this.input[0].value.toLowerCase()),
      // Speed up lookups
                rows = this.rows,
                inputs = this.inputs,
                cache = this.cache;

            if (!term) {
                rows.show();
            } else {
                rows.hide();

                const regex = new RegExp(term.replace(rEscape, '\\$&'), 'gi');

                this._trigger('filter', e, $.map(cache, (v, i) => {
                    if (v.search(regex) !== -1) {
                        rows.eq(i).show();
                        return inputs.get(i);
                    }

                    return null;
                }));
            }

      // Show/hide optgroups
            this.instance.menu.find('.ui-multiselect-optgroup-label').each(function () {
                const $this = $(this);
                const isVisible = $this.nextUntil('.ui-multiselect-optgroup-label').filter(function () {
                    return $.css(this, 'display') !== 'none';
                }).length;

                $this[isVisible ? 'show' : 'hide']();
            });
        },

        _reset() {
            this.input.val('').trigger('keyup');
        },

        _allowInteraction() {
            if ($(event.target).closest('.ui-multiselect-menu').length) {
                return true;
            }
        },

        updateCache() {
      // Each list item
            this.rows = this.instance.menu.find('.ui-multiselect-checkboxes li:not(.ui-multiselect-optgroup-label)');

      // Cache
            this.cache = this.element.children().map(function () {
                let elem = $(this);

        // Account for optgroups
                if (this.tagName.toLowerCase() === 'optgroup') {
                    elem = elem.children();
                }

                return elem.map(function () {
                    return this.innerHTML.toLowerCase();
                }).get();
            }).get();
        },

        widget() {
            return this.wrapper;
        },

        destroy() {
            $.Widget.prototype.destroy.call(this);
            this.input.val('').trigger('keyup');
            this.wrapper.remove();
        }
    });
})(jQuery);
