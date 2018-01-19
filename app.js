var express = require('express');
var fs = require('fs');
var request = require('request');
var download = require('download');
var url = require('url');
var CronJob = require('cron').CronJob;
var mongoose = require('mongoose');
var Video = require('./models/videos');

var _downloadingFile = false;
var _pathCaption = '/home/vault/app/mediaplay-bus/';
var _pathImage = '/home/vault/app/mediaplay-bus/';
var _pathVideo = '/home/vault/app/mediaplay-bus/';
var _indexSync = 0;
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

// Inicializacion de Express
var app = express();
app.use(express.static('/home/vault/app/mediaplay-bus/'));
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    next();
});

// Conexion a la BD y a NodeJs
mongoose.Promise = global.Promise;
mongoose.connect('mongodb://localhost:27017/MediaPlay_BD', { useMongoClient: true })
    .then(() => {
        console.log("Mongoo DB conectada correctamente");
        app.listen(3000, () => console.log("Api REST running on http://localhost:3000"));

		//Se ejecuta cada 15min
		var jobUpdate = new CronJob({
			cronTime: '5 * * * * *',
			onTick: function () {

				if (!_downloadingFile) {
			   	   _downloadingFile = true;
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
function syncToBase() {
    try {
        // Obtenemos el json de videos desde la base
        request.get("http://10.255.255.54:3000/syncToBase", function (err, res, body) {
            if (!err) {
                var videosBase = JSON.parse(body);
                var numberToSync = getLenghtArray(videosBase);

                // Obtenemos la lista de videos de la BD
                Video.find({}, (err, videos) => {
                    if (err) {
						_downloadingFile = false;
						return console.error("Error al obtener todos los videos syncToBase: " + err);
					}

                    // Priorizamos eliminar videos de la BD
                    // Recorro la lista de videos de la bd para ver si hay alguno que no este en 
                    // la lista de videos de base
                    syncDelete(videos, videosBase);

                    // Emparejamos la BD con respecto a la base
                    // Primero vemos si quedan elementos por sincronizar
                    if (_indexSync < numberToSync) {
                        // Buscamos el video por id en la bd
                        Video.findOne({ id: videosBase[_indexSync].id }, (err, video) => {
                            if (err) {
								_downloadingFile = false;
								return console.error("Error al obtener el registro de la bd: " + err);
							}

                            // Esta en la BD de la base
                            if (video != null) {
                                syncUpdate(video.metadata.version, videosBase[_indexSync]);
                            }
                            // No esta en la BD de la base
                            else {
                                syncInsert(videosBase[_indexSync]);
                            }
                        });
                    }
                    else {
                        _indexSync = 0;
                        _downloadingFile = false;
                    }
                });
            }
			else {				
                _downloadingFile = false;
				return console.error("Error de red: " + err);
			}
        });
    }
    catch (err) {        
        _downloadingFile = false;
        return console.error("Ocurrio un error inesperado: " + err);
    }
}

function syncDelete(registrosBd, registrosBase) {
	try {    
		for (var i in registrosBd) {

		    // Recorremos la lista de videos de base
		    var keep = false;
		    for (var x in registrosBase) {
		        // Si el video esta en base hay que mantenerlo, sino eliminarlo
		        if (registrosBd[i].id == registrosBase[x].id) {
		            keep = true;
		        }
		    }

		    // Si no esta en la base lo eliminamos
		    if (!keep) {

				console.log("-----------------------");
				console.log("Inicio de eliminacion del registro id: " + registrosBd[i].id); 

		        // Primero borramos de la bd el registro
		        Video.findOne({ id: registrosBd[i].id }, (err, video) => {
		            if (err) return console.error("Error al buscar el video para eliminarlo: " + err);

		            if (video != null) {
		                video.remove(err => {
		                    if (err) return console.error("Error al eliminar el registro id " + registrosBd[i].id + " de la bd: " + err);

		                    console.log("El registro id " + registrosBd[i].id + " fue eliminado de la bd");
		                })
		            }
		        });

		        // Borramos la imagen
		        var imageDelete = registrosBd[i].image;
		        imageDelete = imageDelete.substring(imageDelete.lastIndexOf("/") + 1, imageDelete.lenght);
		        deleteFile(_pathImage + imageDelete);

		        // Borramos los subtitulos
		        for (var x in registrosBd[i].caption) {
		            var captionDelete = registrosBd[i].caption[x].src;
		            if (captionDelete) {
		                captionDelete = captionDelete.substring(captionDelete.lastIndexOf("/") + 1, captionDelete.lenght);
		                deleteFile(_pathCaption + captionDelete);
		            }
		        }

		        // Borramos el video
		        var videoDelete = registrosBd[i].url;
		        videoDelete = videoDelete.substring(videoDelete.lastIndexOf("=") + 1, videoDelete.lenght);
		        deleteFile(_pathVideo + videoDelete);
		    }
		}
	}
	catch(err) {
		return console.error("Se produjo un error inesperado en syncDelete: " + err);
	}
}

function deleteFile(path) {
    fs.unlink(path, function (err) {
        if (err) {
            return console.error("Error al eliminar el archivo: " + path + "-- Error: " + err);
        }
        console.log("Archivo eliminado: " + path);
    });
}

function syncInsert(registroBase) {
	try {
		console.log("-----------------------------");
		console.log("Inicio de descarga del registro id: " + registroBase.id);

		// Primero descargamos el video 
		download(registroBase.video.urlBase, _pathVideo)
		.then(() => {
		    console.log("Finalizo la descarga del video id: " + registroBase.id)

		    // Descargamos la imagen
		    download(registroBase.image.urlBase, _pathImage)
		    .then(() => {
		        console.log("Finalizo la descarga de la imagen id: " + registroBase.id)

		        // Descargamos los subtitulos. TODO-Se puede descargar hasta 2 por ahora.
		        var lenght = getLenghtArray(registroBase.caption);
		        if (lenght > 0) {
		            var index = 0;
		            download(registroBase.caption[index].urlBase, _pathCaption)
		            .then(() => {
		                console.log("Finalizo la descarga del subtitulo id: " + registroBase.id + " index: " + index);

		                index++;
		                if (index == lenght) {
		                    insertInBD(registroBase);
		                }
		                else {
		                    download(registroBase.caption[index].urlBase, _pathCaption)
		                    .then(() => {
		                        console.log("Finalizo la descarga del subtitulo id: " + registroBase.id + " index: " + index);

		                        insertInBD(registroBase);
		                    });
		                }
		            });
		        } else {
		            insertInBD(registroBase);
		        }
		    });
        });
	} catch(err) {
		return console.error("Se produjo un error inesperado en syncInsert: " + err);
	}
}

function insertInBD(value) {
    // Parseamos el objeto y registramos en la bd
    var video = parserToInsert(value);
    video.save((err, stored) => {
        if (err) return console.error("Error al insertar el registro id " + value.id + " en la bd: " + err);

        console.log("Finalizo la descarga y se inserto el video id: " + video.id);
        _indexSync++;
        syncToBase();
    });
}

function syncUpdate(registroBdVersion, registroBase) {
	try {
		console.log("-------------------------");
		console.log("Inicio de actualizacion del registro id: " + registroBase.id);

		if (registroBdVersion != registroBase.metadata.version) {

		    // Parseamos el objecto para actualizarlo
		    var videoParsed = parserToUpdate(registroBase);

		    //console.log(JSON.stringify(videoParsed))
		    Video.update({ id: registroBase.id }, videoParsed, err => {
		        if (err) return console.error("Error actualizando el registro id " + registroBase.id + " en la bd: " + err);

		        console.log("Finalizo la actualizacion del registro id " + registroBase.id + " en la bd");
		        _indexSync++;
		        syncToBase();
		    });
		}
		else {
		    console.log("No fue necesaria la actualizacion del registro id " + registroBase.id + " en la bd");
		    _indexSync++;
		    syncToBase();
		}
	} catch(err) {
		return console.error("Se produjo un error inesperado en syncUpdate: " + err);
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

    for (var i in value.caption) {
        video.caption.push({
            label: value.caption[i].label,
            languaje: value.caption[i].languaje,
            src: value.caption[i].src,
            kind: value.caption[i].kind,
            default: value.caption[i].default
        });
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

// Funcion para contar el numero de objetos dentro de un array
function getLenghtArray(value) {
    var count = 0;
    for (var i in value) {
        count++;
    }
    return count;
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
		res.status(200).send({ message: "Se eliminaron " + getLenghtArray(video) + " videos" });
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


