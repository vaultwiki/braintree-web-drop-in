'use strict';

var constants = require('../constants');
var assets = require('@braintree/asset-loader');
var Promise = require('./promise');

function DataCollector(config) {
  this._config = config;
}

DataCollector.prototype.initialize = function () {
  var self = this;

  return Promise.resolve().then(function () {
    var braintreeWebVersion;

    if (global.braintree && global.braintree.dataCollector) {
      return Promise.resolve();
    }

    braintreeWebVersion = self._config.client.getVersion();

	  var dcSrc = 'https://js.braintreegateway.com/web/' + braintreeWebVersion + '/js/data-collector.min.js';

	  if (self._config.src)
	  {
		  dcSrc = self._config.src;
	  }

    return assets.loadScript({
      src: dcSrc,
      id: constants.DATA_COLLECTOR_SCRIPT_ID
    });
  }).then(function () {
    return global.braintree.dataCollector.create(self._config);
  }).then(function (instance) {
    self._instance = instance;
  }).catch(function (err) {
    // log the Data Collector setup error
    // but do not prevent Drop-in from loading
    self.log(err);
  });
};

DataCollector.prototype.log = function (message) {
  console.log(message); // eslint-disable-line no-console
};

DataCollector.prototype.getDeviceData = function () {
  if (!this._instance) {
    return '';
  }

  return this._instance.deviceData;
};

DataCollector.prototype.teardown = function () {
  if (!this._instance) {
    return Promise.resolve();
  }

  return this._instance.teardown();
};

module.exports = DataCollector;
