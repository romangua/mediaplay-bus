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
    caption: [
		{
		  label: String,
		  languaje: String,
	      src: String,
		  kind: String,
		  default: String,
		}
	],	
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
