var express = require('express');
var fs = require('fs');
var request = require('request-promise');
var download = require('download');
var url = require('url');
var CronJob = require('cron').CronJob;
var mongoose = require('mongoose');
var Video = require('./models/videos');
var Wireless = require('wireless');
var exec = require('child_process').exec, child;

var _downloadingFile = false;
var _pathCaption = '/home/vault/app/mediaplay-bus/';
var _pathImage = '/home/vault/app/mediaplay-bus/';
var _pathVideo = '/home/vault/app/mediaplay-bus/';
var _wifiSsid = 'InterCordoba_BASE';
var _wifiPassword = 'password';
var _ipBase = "http://192.168.1.101:3000/";
var _gatewayEth0 = '192.168.0.254';
var _isNetworkConnected = false;
var _isNetworkConnecting = false;
var mimeNames = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'application/ogg',
    '.ogv': 'video/ogg',
    '.oga': 'audio/ogg',
    '.txt': 'text/plain',
    '.wav': 'audio/x-wav',
    '.webm': 'video/webm'
};

// Inicializo la lib wirelles
var wireless = new Wireless({
    iface: 'wlan0',
	updateFrequency: 10, // Optional, seconds to scan for networks
	connectionSpyFrequency: 2, // Optional, seconds to scan if connected
	vanishThreshold: 2 // Optional, how many scans before network considered gone
});

// Cuando se detiene el node se ejecuta este evento 
// que detiene la funcion de analisar el wifi
process.on('SIGINT', function() {
	wireless.stop();
});

// Iniciamos el scaneo de wifi
wireless.enable(function(err) {
	if(err)
		return console.error('[FAILURE] Unable to enable wireless card');
		
	// Veo si ya estamos conectado a la wifi
	child = exec("sudo iwgetid -r", function(err, stdout, stderr) {		       
	  if (err) {
		console.error("error al verificar el nombre de a red " + _wifiSsid + ": " + err);
	  } 
	  if(stdout != null && stdout.trim() == _wifiSsid) {
		 console.log("Ya se encuentra conectado a la red: " + _wifiSsid);
		_isNetworkConnected = true;
	  }
	});
		
	wireless.start();
});

// Se conecta a un red wifi
wireless.on('join', function(network) {
    console.log("[JOIN NETWORK] " + network.ssid);	
    if(network.ssid == _wifiSsid) {
		_isNetworkConnected = true;
	}
});

// Evento que recibe las diferentes redes wifi, scanea cada updateFrequency: 10 segundos
wireless.on('signal', function(network) {	
 	if(network.ssid == _wifiSsid && !_isNetworkConnected  && !_isNetworkConnecting) {
        _isNetworkConnecting = true;
        
        // Conecto la wifi
        child = exec("sudo nmcli device wifi connect '" + _wifiSsid + "' password '" + _wifiPassword + "'", function(err, stdout, stderr) {		       
		  if (err) {
			console.error("Error al intentan conectarse a la red " + _wifiSsid + ": " + err);
		  }   		
		  _isNetworkConnecting = false;	
		});
	}
	
	// Elimino el gateway de la lan
	child = exec("sudo route del default gw " + _gatewayEth0, function(err, stdout, stderr) {				
	});
});

// Se desconecta de la red wifi
// Si se estaba realizando una descarga, reinicia el node
wireless.on('leave', function() {
    console.log("[LEAVE NETWORK] Left the network");
	if(_downloadingFile) {
   		child = exec('pm2 restart 0');		
	}	
	_isNetworkConnected = false; 
	_isNetworkConnecting = false;
});	

// Indica un error
wireless.on('error', function(message) {
    console.log("[ERROR NETWORK] " + message);
});

// Inicializacion de Express
var app = express();
app.use(express.static('/home/vault/app/mediaplay-bus/'));
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    next();
});

// Conexion a la BD y a NodeJs
mongoose.Promise = global.Promise;
mongoose.connect('mongodb://localhost:27017/MediaPlay_Bus_BD', { useMongoClient: true })
    .then(() => {
        console.log("Mongoo DB conectada correctamente");
        app.listen(3000, () => console.log("Api REST running on http://localhost:3000"));

		//Se ejecuta cada 5min
		var jobUpdate = new CronJob({
			cronTime: '*/5 * * * *',
			onTick: function () {
				if (!_downloadingFile && _isNetworkConnected) {			   	   
				   syncToBase();
				} 
			},
			start: true, // Inicia el proceso
			runOnInit: true // Le indica que se ejecute al inicializarse
		});
    })
    .catch((err) => {
        return console.error("Error al conectarse a la bd: " + err);
    });

// Sincroniza los videos con la base
async function syncToBase() {
    try {
		_downloadingFile = true;
		console.log("--------Inicio de sincronizacion-------");

        // Obtenemos el json de videos desde la base
		var options = {
			method: 'get',
			uri: _ipBase + 'syncToBase',
			qs: { 
				access_token: 'TODO'
			},
			headers: {
				'User-Agent': 'Request-Promise'
			},
			json: true
		};				
        var videosBase = await request(options);

        // Priorizamos eliminar videos de la BD
        // Recorro la lista de videos de la bd para ver si hay alguno que no este en la lista de videos de base
        await syncDelete(videosBase);

        // Sincronizamos los videos con la base
        for(var i in videosBase) {
            var video = await Video.findOne({ id: videosBase[i].id }).exec();

            // Esta en la BD de la base
            if (video != null) {
                await syncUpdate(video.metadata.version, videosBase[i]);
            }
            // No esta en la BD de la base
            else {
                await syncInsert(videosBase[i]);
            }
        }
    }
    catch(err) {
        console.error("Se produjo un error inesperado: " + err);
    }
	finally {
		syncToBaseEnd();               
	}	
}

function syncToBaseEnd() {
    console.log("--------Finalizo la sincronizacion-------");	
	_downloadingFile = false;
}

async function syncDelete(registrosBase) {
    // Obtenemos la lista de videos de la BD
    var registrosBd = await Video.find({}).exec();
    for (var i in registrosBd) {

        // Recorremos la lista de videos de la base
        var keep = false;
        for (var x in registrosBase) {
            // Si el video esta en la base hay que mantenerlo, sino eliminarlo
            if (registrosBd[i].id == registrosBase[x].id) {
                keep = true;
            }
        }

        // Si no esta en la base lo eliminamos
        if (!keep) {   
         
            // Primero borramos de la bd el registro
            await Video.findOneAndRemove({ id: registrosBd[i].id }).exec();
            console.log("El registro id " + registrosBd[i].id + " fue eliminado de la bd");

            // Borramos la imagen
            var imageDelete = registrosBd[i].image;
            imageDelete = imageDelete.substring(imageDelete.lastIndexOf("/") + 1, imageDelete.lenght);
            await deleteFile(_pathImage + imageDelete);

            // Borramos los subtitulos
            for (var x in registrosBd[i].caption.cap) {
                var captionDelete = registrosBd[i].caption.cap[x].url;
                if (captionDelete) {
                    captionDelete = captionDelete.substring(captionDelete.lastIndexOf("/") + 1, captionDelete.lenght);
                    await deleteFile(_pathCaption + captionDelete);
                }
            }

            // Borramos el video
            var videoDelete = registrosBd[i].url;
            videoDelete = videoDelete.substring(videoDelete.lastIndexOf("=") + 1, videoDelete.lenght);
            await deleteFile(_pathVideo + videoDelete);

            // Borramos la publicidad
            if(registrosBd[i].advertising) {
                // Borramos ads video
                for (var x in registrosBd[i].advertising.video) {
                    var adsVideo = registrosBd[i].advertising.video[x].url;
                    if (adsVideo) {
                        adsVideo = adsVideo.substring(adsVideo.lastIndexOf("/") + 1, adsVideo.lenght);
                        await deleteFile(_pathVideo + adsVideo);
                    }
                }

                // Borramos ads image
                for (var x in registrosBd[i].advertising.image) {
                    var adsImage = registrosBd[i].advertising.image[x].url;
                    if (adsImage) {
                        adsImage = adsImage.substring(adsImage.lastIndexOf("/") + 1, adsImage.lenght);
                        await deleteFile(_pathImage + adsImage);
                    }
                }
            }
        }
    }
}

async function deleteFile(path) {
    await fs.unlink(path, ()=>{});
    console.log("Archivo eliminado: " + path);
}

async function syncInsert(registroBase) {

    // Primero descargamos el video 
    await download(registroBase.video.urlBase, _pathVideo)
    console.log("Finalizo la descarga del video id: " + registroBase.id)

    // Descargamos la imagen
    await download(registroBase.image.urlBase, _pathImage)
    console.log("Finalizo la descarga de la imagen id: " + registroBase.id)

    // Descargamos la publicidad
    if(registroBase.advertising) {
        // Videos
        if(registroBase.advertising.video) {
            for(var i in registroBase.advertising.video) {
                await download(registroBase.advertising.video[i].urlBase, _pathVideo)
                console.log("Finalizo la descarga del ads video id: " + registroBase.id + " index: " + i)
            }
        }
        // Imagenes
        if(registroBase.advertising.image) {
            for(var i in registroBase.advertising.image) {
                await download(registroBase.advertising.image[i].urlBase, _pathImage)
                console.log("Finalizo la descarga del ads image id: " + registroBase.id + " index: " + i)
            }
        }
    }

    // Descargamos los subtitulos
    if(registroBase.caption) {
        for(var i in registroBase.caption.cap) {
            await download(registroBase.caption.cap[i].urlBase, _pathCaption)
            console.log("Finalizo la descarga del subtitulo id: " + registroBase.id + " index: " + i)
        }
    }

    // Insertamos el registro en la bd
    var video = parserToInsert(registroBase);
    await video.save();
    console.log("Finalizo la descarga y se inserto el video id: " + video.id);
}

async function syncUpdate(registroBdVersion, registroBase) {
    if (registroBdVersion != registroBase.metadata.version) {

        // Parseamos el objecto para actualizarlo
        var videoParsed = parserToUpdate(registroBase);

        await Video.update({ id: registroBase.id }, videoParsed).exec()
        console.log("Finalizo la actualizacion del registro id " + registroBase.id + " en la bd");
    }
    else {
        console.log("No fue necesaria la actualizacion del registro id " + registroBase.id + " en la bd");  
    }
}

function parserToInsert(value) {
    var video = new Video();

    video.id = value.id;
    video.description = value.description;
    video.year = value.year;
    video.staring = value.staring;
    video.director = value.director;
    video.url = value.video.url;
    video.clasification = value.clasification;
    video.name = value.name;
    video.duration = value.duration;
    video.type = value.type;
    video.image = value.image.url;
    video.metadata = {
        version: value.metadata.version
    };

    if(value.caption) {
        for (var i in value.caption.cap) {
            video.caption.cap.push({
                label: value.caption.cap[i].label,
                url: value.caption.cap[i].url
            });
        }
        video.caption.default = value.caption.default;
    }
   
    if(value.advertising) {
        if(value.advertising.video) {
            for(var i in value.advertising.video) {
                video.advertising.video.push({
                    start: value.advertising.video[i].start,
                    hold: value.advertising.video[i].hold,
                    url: value.advertising.video[i].url
                });
            }
        }

        if(value.advertising.image) {
            for(var i in value.advertising.image) {
                video.advertising.image.push({
                    start: value.advertising.image[i].start,
                    end: value.advertising.image[i].end,
                    hold: value.advertising.image[i].hold,
                    url: value.advertising.image[i].url
                });
            }
        }
    }
    return video;
}

function parserToUpdate(value) {
    var video = {
        "id": value.id,
        "description": value.description,
        "year": value.year,
        "staring": value.staring,
        "director": value.director,
        "clasification": value.clasification,
        "name": value.name,
        "duration": value.duration,
        "type": value.type,
        "metadata": {
            "version": value.metadata.version
        }
    }
    return video;
}

// SoloTest: Endpoint para limpiar la BD
app.get('/deleteAll', function(req,res, next) {

    // Obtenemos la lista de videos de la BD
    Video.find({}, (err, video) => {
        if(err) res.status(500).send("Error al obtener todos los videos: " + err);
        
        for(var i in video) {
			if(video[i] != null) {
				video[i].remove(err => {
					if(err) res.status(500).send({ message: "Error al eliminar el video " + err });
				});
			}
		}
		res.status(200).send({ message: "Se eliminaron   videos" });
    });
});

// Endpoint para que los usuario consulten la lista de videos
app.get('/getVideos', function(req,res, next) {

    // Obtenemos la lista de videos de la BD
    Video.find({}, (err, videos) => {
        if (err) res.status(400).send({ message: "Error al obtener todos los videos: " + err });
        
        res.status(200).send(videos);
    });
});

// Endpoint para reproducir un video
app.get('/getVideo', function(req, res, next){
    var paramId = req.query.id;
    var fileName = _pathVideo + paramId;

    // Obtenemos la extencion. Ejemplo: ".mp4"
    var extName = paramId.substring(paramId.indexOf('.'), paramId.lenght);
 
    // Check if file exists. If not, will return the 404 'Not Found'.
    if (!fs.existsSync(fileName)) {
        res.status(404).send({ message: "No se encuentra el video: " + fileName });
    }

    var responseHeaders = {};
    var stat = fs.statSync(fileName);
    var rangeRequest = readRangeHeader(req.headers['range'], stat.size);

    // If 'Range' header exists, we will parse it with Regular Expression.
    if (rangeRequest == null) {
        responseHeaders['Content-Type'] = getMimeNameFromExt(extName);
        responseHeaders['Content-Length'] = stat.size;  
        responseHeaders['Accept-Ranges'] = 'bytes';

        //  If not, will return file directly.
        sendResponse(res, 200, responseHeaders, fs.createReadStream(fileName));
        return null;
    }

    var start = rangeRequest.Start;
    var end = rangeRequest.End;

    // If the range can't be fulfilled.
    if (start >= stat.size || end >= stat.size) {
        // Indicate the acceptable range.
        responseHeaders['Content-Range'] = 'bytes */' + stat.size; // File size.

        // Return the 416 'Requested Range Not Satisfiable'.
        sendResponse(res, 416, responseHeaders, null);
        return null;
    }

    // Indicate the current range.
    responseHeaders['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
    responseHeaders['Content-Length'] = start == end ? 0 : (end - start + 1);
    responseHeaders['Content-Type'] = getMimeNameFromExt(extName);
    responseHeaders['Accept-Ranges'] = 'bytes';
    responseHeaders['Cache-Control'] = 'no-cache';

    // Return the 206 'Partial Content'.
    sendResponse(res, 206, responseHeaders, fs.createReadStream(fileName, { start: start, end: end }));
});

function sendResponse(	response, responseStatus, responseHeaders, readable) {
    response.writeHead(responseStatus, responseHeaders);

    if (readable == null)
        response.end();
    else
        readable.on('open', function () {
            readable.pipe(response);
        });

    return null;
}

function getMimeNameFromExt(ext) {
    var result = mimeNames[ext.toLowerCase()];

    // It's better to give a default value.
    if (result == null)
        result = 'application/octet-stream';

    return result;
}

function readRangeHeader(range, totalLength) {
    if (range == null || range.length == 0)
        return null;

    var array = range.split(/bytes=([0-9]*)-([0-9]*)/);
    var start = parseInt(array[1]);
    var end = parseInt(array[2]);
    var result = {
        Start: isNaN(start) ? 0 : start,
        End: isNaN(end) ? (totalLength - 1) : end
    };

    if (!isNaN(start) && isNaN(end)) {
        result.Start = start;
        result.End = totalLength - 1;
    }

    if (isNaN(start) && !isNaN(end)) {
        result.Start = totalLength - end;
        result.End = totalLength - 1;
    }
    console.log("result: " + JSON.stringify(result));
    return result;
}


