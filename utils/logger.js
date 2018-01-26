var winston = require('winston');
winston.emitErrs = true;

var logger = new winston.Logger({
    transports: [
        new winston.transports.File({
            filename: '/home/vault/app/mediaplay-bus/all-logs.log',
            handleExceptions: true,
            json: false,
            colorize: false,
			timestamp: function() { return new Date()}
        }),
        new winston.transports.Console({
            level: 'debug',
            handleExceptions: true,
            json: false,
            colorize: true,
            timestamp: function() { return new Date()}
        })
    ],
    exitOnError: false
});

module.exports = logger;
module.exports.stream = {
    write: function(message, encoding){
        logger.info(message);
    }
};
