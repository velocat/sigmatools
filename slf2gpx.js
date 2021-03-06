#!/usr/bin/env node

//SLF Format Parser

var xml2js = require('xml2js');
var fs  = require('fs');
var _ = require('underscore');
var util= require('util');
var moment = require('moment');


var argv = require('minimist')(process.argv.slice(2),
                               {boolean:
                                ["debug","silent","keepnongps","nopauses"],
                               alias:
                                { debug: "d",
                                  silent: "s",
                                  keepnongps: "k",
                                  nopauses: "p"}});


var options = {
    filterOutNonGps: true,
    processPauses: true,
    debug: false,
    silent: false
};

var debug = function(msg){
  if(options.debug) console.log(msg);
}

var log = function(msg){
  if(!options.silent) console.log(msg);
}

var readXml = function(file, cb){
    var parser = new xml2js.Parser({explicitArray: false});
    fs.readFile(file, function(err, data) {
        parser.parseString(data, cb);
    });
};


var convertMetadata = function(generalInfo){
    return {
	time: generalInfo.StartDate
    };
}

var convertTrkPt = function(logEntry, startDate){
    return {
	'$': {
	    lat: parseFloat(logEntry.Latitude).toFixed(7),
	    lon: parseFloat(logEntry.Longitude).toFixed(7)
	},
	ele: (logEntry.Altitude/1000).toFixed(1),
	time: startDate.add(logEntry.Number, 'seconds').toISOString(),
	extensions: {
	    'gpxtpx:TrackPointExtension': {
		'gpxtpx:atemp': Math.floor(logEntry.Temperature),
		'gpxtpx:hr': parseInt(logEntry.Heartrate),
		'gpxtpx:cad': parseInt(logEntry.Cadence)
	    }
	}
    };
}



var mapPauseMarker = function(marker, idx, markers){
  var time = Math.ceil(parseFloat(marker.TimeAbsolute));
  return {
    time: parseFloat(marker.TimeAbsolute),
    duration: parseFloat(marker.Duration),
    isPause: marker.MarkerType === 'p'
  };
}

var findMarker = function(markerMap, offset, duration){
  "Finds marker within offset and offset+duration time interval"
  return _.filter(markerMap, function(marker){
    return marker.time >= offset && marker.time < (offset+duration);
  });
}

//Put in proper timings to each trkpt
var timify = function(markers, trkpts, startDate){
  _.each(trkpts, function(trkpt, idx){

    if(options.processPauses){
      //has Marker?
      var marker = findMarker(markers, trkpt.internals.offset, trkpt.internals.duration);
      if(marker && marker.length>0){
        _.each(marker, function(m){
          debug("inserting break of "+m.duration+" seconds before trkpt "+idx);
          startDate.add(m.duration, 'seconds');
        });
      }
    }
    trkpt.time = startDate.toISOString();
    startDate.add(trkpt.internals.duration, 'seconds');
  });

}

var gpxHeader = function(){
return { '$': {
  creator: 'SigmaTools by bonkzwonil slf2gpx',
  version: '1.1',
  xmlns: 'http://www.topografix.com/GPX/1/1',
  'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  'xsi:schemaLocation': 'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd',
  'xmlns:gpxtpx': 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1',
  'xmlns:gpxx': 'http://www.garmin.com/xmlschemas/GpxExtensions/v3' }
       };
}


if(argv.h || argv.help){
  console.log("Help: \n\
 -h or --help:\t\t this help\n\
 -p or --nopauses:\t do not process pause markers. This will lead to wrong daytimes in trkpts\n\
 -k or --keepnongps:\t do not filter out points without gps coords.\n\
 -d or --debug:\t\t debug on\n\
 -s or --silent:\t rig for silent running\n");
  process.exit(1);
}

if(argv._.length < 2){
  console.log("Usage: $ node slf2gpx.js [-hpskd] input.slf output.gpx");
  process.exit(1);
}

options.processPauses = !argv.nopauses;
options.filterOutNonGps = !argv.keepnongps;
options.debug = argv.debug;
options.silent = argv.silent;



log("Reading "+argv._[0]);
readXml(argv._[0], function(err, xml){

  log("Processing Log with "+xml.Log.LogEntries.LogEntry.length+" log entries");

  var gpx = gpxHeader();
  gpx.metadata = {
    time: moment(new Date(xml.Log.GeneralInformation.StartDate)).toISOString()
  };
  gpx.trk = {
    name: xml.Log.GeneralInformation.Name,
    trkseg: {
      trkpt: _.map(xml.Log.LogEntries.LogEntry,
              function(logEntry,idx, entries){
                var pt = convertTrkPt(logEntry, moment());
                pt.internals = { duration: parseFloat(logEntry.RideTime) };
                return pt;
              })
    }
  };


  log("fixing timings");
  //fix internal timings
  _.reduce(gpx.trk.trkseg.trkpt, function(offset, pt){
    pt.internals.offset = offset;
    return offset + pt.internals.duration;
  }, 0.0);

  timify(_.map(xml.Log.Markers.Marker, mapPauseMarker),
         gpx.trk.trkseg.trkpt,
         moment(new Date(xml.Log.GeneralInformation.StartDate))
        );


  log("filtering");
  if(options.filterOutNonGps){
    gpx.trk.trkseg.trkpt = _.filter(gpx.trk.trkseg.trkpt, function(pt){
      return parseFloat(pt['$'].lat)>0&&parseFloat(pt['$'].lon)>0;
    });
  };

  //cleaning up internals
  _.each(gpx.trk.trkseg.trkpt, function(pt){
    delete pt.internals;
  });

  log("writing gpx to "+argv._[1]);
  var builder = new xml2js.Builder({rootName: 'gpx'});
  var outXml = builder.buildObject(gpx);
  fs.writeFileSync(argv._[1], outXml);
});
