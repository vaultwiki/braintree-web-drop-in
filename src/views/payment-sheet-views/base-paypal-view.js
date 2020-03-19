'use strict';

var assign = require('../../lib/assign').assign;
var BaseView = require('../base-view');
var btPaypal = require('braintree-web/paypal-checkout');
var DropinError = require('../../lib/dropin-error');
var constants = require('../../constants');
var assets = require('@braintree/asset-loader');
var translations = require('../../translations').fiveCharacterLocales;
var Promise = require('../../lib/promise');

var ASYNC_DEPENDENCY_TIMEOUT = 30000;
var READ_ONLY_CONFIGURATION_OPTIONS = [
  'commit',
  'flow',
  'intent',
  'locale',
  'offerCredit'
];
var DEFAULT_INTENT = 'authorize';

var paypalScriptLoadInProgressPromise;

function BasePayPalView() {
  BaseView.apply(this, arguments);
}

BasePayPalView.prototype = Object.create(BaseView.prototype);

BasePayPalView.prototype.initialize = function () {
  var asyncDependencyTimeoutHandler;
  var isCredit = Boolean(this._isPayPalCredit);
  var setupComplete = false;
  var self = this;
  var paypalType = isCredit ? 'paypalCredit' : 'paypal';
  var paypalConfiguration = this.model.merchantConfiguration[paypalType];

  this.paypalConfiguration = assign({}, {
    vault: {}
  }, paypalConfiguration);
  this.vaultConfig = this.paypalConfiguration.vault;
  delete this.paypalConfiguration.vault;

  this.model.asyncDependencyStarting();
  asyncDependencyTimeoutHandler = setTimeout(function () {
    self.model.asyncDependencyFailed({
      view: self.ID,
      error: new DropinError('There was an error connecting to PayPal.')
    });
  }, ASYNC_DEPENDENCY_TIMEOUT);

  return btPaypal.create({
    authorization: this.model.authorization
  }).then(function (paypalInstance) {
    self.paypalInstance = paypalInstance;
    self.paypalConfiguration.offerCredit = Boolean(isCredit);

    return self._loadPayPalSDK();
  }).then(function () {
    var buttonSelector = '[data-braintree-id="paypal-button"]';
    var environment = self.model.environment === 'production' ? 'production' : 'sandbox';
    var locale = self.model.merchantConfiguration.locale;
    var checkoutJSConfiguration = {
      env: environment,
      style: self.paypalConfiguration.buttonStyle || {},
      commit: self.paypalConfiguration.commit,
      payment: function () {
        return self.paypalInstance.createPayment(self.paypalConfiguration).catch(reportError);
      },
      onAuthorize: function (data) {
        var shouldVault = self._shouldVault();

        data.vault = shouldVault;

        return self.paypalInstance.tokenizePayment(data).then(function (tokenizePayload) {
          if (shouldVault) {
            tokenizePayload.vaulted = true;
          }
          self.model.addPaymentMethod(tokenizePayload);
        }).catch(reportError);
      },
      onError: reportError
    };

    if (locale && locale in translations) {
      self.paypalConfiguration.locale = locale;
      checkoutJSConfiguration.locale = locale;
    }
    checkoutJSConfiguration.funding = {
      disallowed: []
    };

    Object.keys(global.paypal.FUNDING).forEach(function (key) {
      if (key === 'PAYPAL' || key === 'CREDIT') {
        return;
      }
      checkoutJSConfiguration.funding.disallowed.push(global.paypal.FUNDING[key]);
    });

    if (isCredit) {
      buttonSelector = '[data-braintree-id="paypal-credit-button"]';
      checkoutJSConfiguration.style.label = 'credit';
    } else {
      checkoutJSConfiguration.funding.disallowed.push(global.paypal.FUNDING.CREDIT);
    }

    return global.paypal.Button.render(checkoutJSConfiguration, buttonSelector).then(function () {
      self.model.asyncDependencyReady();
      setupComplete = true;
      clearTimeout(asyncDependencyTimeoutHandler);
    });
  }).catch(reportError);

  function reportError(err) {
    if (setupComplete) {
      self.model.reportError(err);
    } else {
      self.model.asyncDependencyFailed({
        view: self.ID,
        error: err
      });
      clearTimeout(asyncDependencyTimeoutHandler);
    }
  }
};

BasePayPalView.prototype.requestPaymentMethod = function () {
  this.model.reportError('paypalButtonMustBeUsed');

  return BaseView.prototype.requestPaymentMethod.call(this);
};

BasePayPalView.prototype.updateConfiguration = function (key, value) {
  if (key === 'vault') {
    this.vaultConfig = value;

    return;
  }

  if (READ_ONLY_CONFIGURATION_OPTIONS.indexOf(key) === -1) {
    this.paypalConfiguration[key] = value;
  }
};

BasePayPalView.prototype._loadPayPalSDK = function () {
  var config = this.paypalConfiguration;

  if (!paypalScriptLoadInProgressPromise) {
    paypalScriptLoadInProgressPromise = this.paypalInstance.getClientId().then(function (id) {
      var src = constants.PAYPAL_SDK_JS_SOURCE + '?client-id=' + id + '&components=buttons,funding-eligibility';
      var intent = config.intent;

      if (config.flow === 'vault') {
        src += '&vault=true';
      } else {
        intent = intent || DEFAULT_INTENT;
      }

      if (intent) {
        src += '&intent=' + intent;
      }

      if (config.locale) {
        src += '&locale=' + config.locale;
      }

      if (config.commit) {
        src += '&commit=' + config.commit;
      }

      return assets.loadScript({
        src: src,
        id: constants.PAYPAL_SDK_SCRIPT_ID
      });
    });
  }

  return paypalScriptLoadInProgressPromise;
};

BasePayPalView.prototype._shouldVault = function () {
  if (this.paypalConfiguration.flow !== 'vault') {
    return false;
  }

  if (this.vaultConfig.hasOwnProperty('autoVault')) {
    return this.vaultConfig.autoVault;
  }

  return this.model.vaultManagerConfig.autoVaultPaymentMethods;
};

BasePayPalView.isEnabled = function () {
  return Promise.resolve(true);
};

BasePayPalView.resetPayPalScriptPromise = function () {
  paypalScriptLoadInProgressPromise = null;
};

module.exports = BasePayPalView;
