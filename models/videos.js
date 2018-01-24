'use strict'

var mongoose = require('mongoose');
var Schema = mongoose.Schema;

const VideoSchema = Schema ({
    id: Number,
    description:  String,
    year: Number,
    staring: String,
    director: String,
    url: String,
    caption: {
      cap: [{
          label: String,
          url: String,
        }],
      default: Number
    },	
    advertising: {
      video : [{
        start: String,
        hold: Number,
        url: String
      }],
      image: [{
        start: String,
        end: String,
        hold: Number,
        url: String
      }]
    },
    clasification: String,
    name: String,
    duration: Number,
    type: String,
    image: String,
    metadata: {
      version: Number
    }
});

module.exports = mongoose.model('Video', VideoSchema);
