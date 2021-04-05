/* global sauce */

import FitParser from './jsfit/fit-parser.mjs';


class Serializer {
    constructor(name, desc, type, start, laps) {
        this.activity = {
            name,
            desc,
            type,
            start,
            laps
        };
    }

    start() {
        // virtual
    }

    loadStreams(streams) {
        throw new Error("pure virtual");
    }

    getFilename() {
        let name = this.activity.name;
        name = name.replace(/\s/g, '_');
        name = name.replace(/\.+$/g, '');
        name = name.replace(/\./g, '_');
        return `${name}.${this.fileExt}`;
    }

    toFile() {
        // virtual
    }
}


class DOMSerializer extends Serializer {
    constructor(...args) {
        super(...args);
        this.doc = new Document();
    }

    addNodeTo(parent, name, textValue) {
        const node = parent.appendChild(this.doc.createElement(name));
        if (textValue != null) {
            node.textContent = textValue.toString();
        }
        return node;
    }

    toFile() {
        const heading = `<?xml version="1.0" encoding="${this.doc.inputEncoding}"?>\n`;
        return new File([heading + (new XMLSerializer()).serializeToString(this.doc)],
            this.getFilename(), {type: 'text/xml'});
    }
}


export class GPXSerializer extends DOMSerializer {

    start() {
        this.fileExt = 'gpx';
        this.rootNode = this.addNodeTo(this.doc, 'gpx');
        this.rootNode.setAttribute('creator', 'Strava Sauce');
        this.rootNode.setAttribute('version', '1.1');
        this.rootNode.setAttribute('xmlns', 'http://www.topografix.com/GPX/1/1');
        this.rootNode.setAttribute('xmlns:gpx3', 'http://www.garmin.com/xmlschemas/GpxExtensions/v3');
        this.rootNode.setAttribute('xmlns:tpx1', 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1');
        this.rootNode.setAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'xsi:schemaLocation', [
            'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd',
            'http://www.garmin.com/xmlschemas/GpxExtensions/v3 https://www8.garmin.com/xmlschemas/GpxExtensionsv3.xsd',
            'http://www.garmin.com/xmlschemas/TrackPointExtension/v1 https://www8.garmin.com/xmlschemas/TrackPointExtensionv1.xsd',
        ].join(' '));
        const metadata = this.addNodeTo(this.rootNode, 'metadata');
        this.addNodeTo(metadata, 'time', this.activity.start.toISOString());
        const trk = this.addNodeTo(this.rootNode, 'trk');
        this.addNodeTo(trk, 'name', this.activity.name);
        if (this.activity.desc) {
            this.addNodeTo(trk, 'desc', this.activity.desc);
        }
        // I can't find any docs on this enum.
        // I got these values by examining garmin output (strava uses numbers! lol).
        const trackTypeEnum = {
            ride: 'cycling',
            run: 'running'
        };
        this.addNodeTo(trk, 'type', trackTypeEnum[this.activity.type]);
        this.trkseg = this.addNodeTo(trk, 'trkseg');
    }

    loadStreams(streams) {
        const startTime = this.activity.start.getTime();
        for (let i = 0; i < streams.time.length; i++) {
            const point = this.addNodeTo(this.trkseg, 'trkpt');
            if (streams.latlng) {
                const [lat, lon] = streams.latlng[i];
                point.setAttribute('lat', lat);
                point.setAttribute('lon', lon);
            }
            const t = (new Date(startTime + (streams.time[i] * 1000)));
            this.addNodeTo(point, 'time', t.toISOString());
            if (streams.altitude) {
                this.addNodeTo(point, 'ele', streams.altitude[i]);
            }
            const ext = this.addNodeTo(point, 'extensions');
            if (streams.watts && streams.watts[i] != null) {
                // NOTE: This is non standard and only works with GoldenCheetah.
                this.addNodeTo(ext, 'power', Math.round(streams.watts[i]));
            }
            if (streams.temp || streams.heartrate || streams.cadence) {
                const tpx = this.addNodeTo(ext, 'tpx1:TrackPointExtension');
                if (streams.temp) {
                    this.addNodeTo(tpx, 'tpx1:atemp', streams.temp[i]);
                }
                if (streams.heartrate) {
                    this.addNodeTo(tpx, 'tpx1:hr', streams.heartrate[i]);
                }
                if (streams.cadence) {
                    this.addNodeTo(tpx, 'tpx1:cad', streams.cadence[i]);
                }
            }
        }
    }
}


export class TCXSerializer extends DOMSerializer {

    start() {
        this.fileExt = 'tcx';
        this.rootNode = this.addNodeTo(this.doc, 'TrainingCenterDatabase');
        this.rootNode.setAttribute('xmlns', 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2');
        this.rootNode.setAttribute('xmlns:up2', 'http://www.garmin.com/xmlschemas/UserProfile/v2');
        // NOTE: This must be 'ns3' to support Strava's broken parser.
        this.rootNode.setAttribute('xmlns:ns3', 'http://www.garmin.com/xmlschemas/ActivityExtension/v2');
        this.rootNode.setAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'xsi:schemaLocation', [
            'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 https://www8.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd',
            'http://www.garmin.com/xmlschemas/UserProfile/v2 https://www8.garmin.com/xmlschemas/UserProfileExtensionv2.xsd',
            'http://www.garmin.com/xmlschemas/ActivityExtension/v2 https://www8.garmin.com/xmlschemas/ActivityExtensionv2.xsd',
        ].join(' '));
        const author = this.addNodeTo(this.rootNode, 'Author');
        author.setAttribute('xsi:type', 'Application_t');
        this.addNodeTo(author, 'Name', sauce.name);
        this.addNodeTo(author, 'LangID', 'en');
        this.addNodeTo(author, 'PartNumber', '867-5309');
        const build = this.addNodeTo(author, 'Build');
        const sauceVersion = this.addNodeTo(build, 'Version');
        const [vmajor, vminor, bmajor] = sauce.version.split('.');
        this.addNodeTo(sauceVersion, 'VersionMajor', vmajor);
        this.addNodeTo(sauceVersion, 'VersionMinor', vminor);
        this.addNodeTo(sauceVersion, 'BuildMajor', bmajor);
        this.addNodeTo(sauceVersion, 'BuildMinor', 0);
        const activities = this.addNodeTo(this.rootNode, 'Activities');
        this.activityNode = this.addNodeTo(activities, 'Activity');
        const sportEnum = {
            ride: 'Biking',
            run: 'Running'
        };
        this.activityNode.setAttribute('Sport', sportEnum[this.activity.type] || 'Other');
        const startISOString = this.activity.start.toISOString();
        this.addNodeTo(this.activityNode, 'Id', startISOString);  // Garmin does, so we will too.
        const notes = this.activity.desc ?
            `${this.activity.name}\n\n${this.activity.desc}` :
            this.activity.name;
        this.addNodeTo(this.activityNode, 'Notes', notes);
        const creator = this.addNodeTo(this.activityNode, 'Creator');
        creator.setAttribute('xsi:type', 'Device_t');  // Could maybe be Application_t too.
        this.addNodeTo(creator, 'Name', sauce.name);
        this.addNodeTo(creator, 'UnitId', 0);
        this.addNodeTo(creator, 'ProductId', 0);
        creator.appendChild(sauceVersion.cloneNode(/*deep*/ true));
    }

    loadStreams(streams) {
        const startTime = this.activity.start.getTime();
        const hasLaps = !!(this.activity.laps && this.activity.laps.length);
        const laps = hasLaps ? this.activity.laps : [[0, streams.time.length - 1]];
        for (const [start, end] of laps) {
            const lap = this.addNodeTo(this.activityNode, 'Lap');
            const lapTime = (new Date(startTime + (streams.time[start] * 1000))).toISOString();
            lap.setAttribute('StartTime', lapTime);
            this.addNodeTo(lap, 'TriggerMethod', 'Manual');
            this.addNodeTo(lap, 'TotalTimeSeconds', streams.time[end] - streams.time[start]);
            if (streams.distance) {
                this.addNodeTo(lap, 'DistanceMeters', streams.distance[end] - streams.distance[start]);
            }
            if (streams.heartrate) {
                const lapStream = streams.heartrate.slice(start, end);
                const avg = this.addNodeTo(lap, 'AverageHeartRateBpm');
                this.addNodeTo(avg, 'Value', Math.round(sauce.data.avg(lapStream)));
                const max = this.addNodeTo(lap, 'MaximumHeartRateBpm');
                this.addNodeTo(max, 'Value', sauce.data.max(lapStream));
            }
            const track = this.addNodeTo(lap, 'Track');
            for (let i = start; i <= end; i++) {
                const point = this.addNodeTo(track, 'Trackpoint');
                const time = (new Date(startTime + (streams.time[i] * 1000))).toISOString();
                this.addNodeTo(point, 'Time', time);
                if (streams.latlng) {
                    const [lat, lon] = streams.latlng[i];
                    const position = this.addNodeTo(point, 'Position');
                    this.addNodeTo(position, 'LatitudeDegrees', lat);
                    this.addNodeTo(position, 'LongitudeDegrees', lon);
                }
                if (streams.altitude) {
                    this.addNodeTo(point, 'AltitudeMeters', streams.altitude[i]);
                }
                if (streams.distance) {
                    this.addNodeTo(point, 'DistanceMeters', streams.distance[i]);
                }
                if (streams.heartrate) {
                    const hr = this.addNodeTo(point, 'HeartRateBpm');
                    this.addNodeTo(hr, 'Value', streams.heartrate[i]);
                }
                if (streams.cadence) {
                    // XXX Might be more accurate to use RunCadence ext for running types.
                    this.addNodeTo(point, 'Cadence', streams.cadence[i]);
                }
                if (streams.watts) {
                    const ext = this.addNodeTo(point, 'Extensions');
                    const tpx = this.addNodeTo(ext, 'ns3:TPX');
                    const watts = streams.watts[i];
                    if (watts != null) {
                        this.addNodeTo(tpx, 'ns3:Watts', Math.round(watts));
                    }
                }
            }
        }
    }
}


export class FITSerializer extends Serializer {

    start() {
        this.fileExt = 'fit';
        this.fitParser = new FitParser();
        const now = Date.now();
        this.fitParser.addMessage('file_id', {
            type: 'activity',
            manufacturer: 0,
            product: 0,
            time_created: now,
            serial_number: 0,
            number: null,
            product_name: 'Sauce',
        });
        const [vmajor, vminor, bmajor] = sauce.version.split('.');
        this.fitParser.addMessage('file_creator', {
            software_version: Number([vmajor.slice(0, 2),
                vminor.slice(0, 2).padStart(2, '0'),
                bmajor.slice(0, 2).padStart(2, '0')].join('')),
            hardware_version: null,
        });
    }

    loadStreams(streams) {
        const startDate = this.activity.start;
        const startTime = startDate.getTime();
        const sport = {
            ride: 'cycling',
            run: 'running',
            swim: 'swimming',
        }[this.activity.type] || 'generic';
        this.fitParser.addMessage('event', {
            event: 'timer',
            event_type: 'start',
            event_group: 0,
            timestamp: startDate,
            data: 'manual',
        });
        const hasLaps = !!(this.activity.laps && this.activity.laps.length);
        const laps = hasLaps ? this.activity.laps : [[0, streams.time.length - 1]];
        for (const [start, end] of laps) {
            for (let i = start; i <= end; i++) {
                const record = {
                    timestamp: new Date(startTime + (streams.time[i] * 1000)),
                };
                if (streams.latlng) {
                    [record.position_lat, record.position_long] = streams.latlng[i];
                }
                if (streams.altitude) {
                    record.enhanced_altitude = (record.altitude = streams.altitude[i]);
                }
                if (streams.distance) {
                    record.distance = streams.distance[i];
                    if (streams.velocity_smooth) {
                        record.enhanced_speed = (record.speed = streams.velocity_smooth[i]);
                    }
                }
                if (streams.heartrate) {
                    record.heart_rate = streams.heartrate[i];
                }
                if (streams.cadence) {
                    record.cadence = streams.cadence[i];
                }
                if (streams.temp) {
                    record.temperature = streams.temp[i];
                }
                if (streams.watts && streams.watts[i] != null) {
                    record.power = Math.round(streams.watts[i]);
                }
                this.fitParser.addMessage('record', record);
            }
            const lastLap = end === streams.time.length - 1;
            const lap = {
                lap_trigger: lastLap ? 'session_end' : 'manual',
                event: 'lap',
                event_type: 'stop',
                sport,
                timestamp: new Date(startTime + (streams.time[end] * 1000)),
                start_time: new Date(startTime + (streams.time[start] * 1000)),
                total_cycles: end - start,
                total_elapsed_time: streams.time[end] - streams.time[start],
                total_timer_time: streams.time[end] - streams.time[start],
            };
            if (streams.latlng) {
                lap.start_position_lat = streams.latlng[start][0];
                lap.start_position_long = streams.latlng[start][1];
                lap.end_position_lat = streams.latlng[end][0];
                lap.end_position_long = streams.latlng[end][1];
            }
            if (streams.distance) {
                lap.total_distance = streams.distance[end] - streams.distance[start];
            }
            this.fitParser.addMessage('lap', lap);
        }
        const elapsed = streams.time[streams.time.length - 1] - streams.time[0];
        const endDate = new Date(startTime + elapsed * 1000);
        const distance = streams.distance ?
            streams.distance[streams.distance.length - 1] - streams.distance[0] :
            null;
        this.fitParser.addMessage('event', {
            timestamp: endDate,
            event: 'session',
            event_type: 'stop_disable_all',
            data: 1,
            event_group: 1,
        });
        this.fitParser.addMessage('session', {
            timestamp: endDate,
            event: 'lap',
            event_type: 'stop',
            start_time: startDate,
            sport,
            sub_sport: 'generic',
            total_elapsed_time: elapsed,
            total_timer_time: elapsed,
            total_distance: distance,
            total_cycles: streams.time.length,
            first_lap_index: 0,
            num_laps: laps.length,
            trigger: 'activity_end',
        });
        this.fitParser.addMessage('activity', {
            timestamp: endDate,
            total_timer_time: elapsed,
            num_sessions: 1,
            type: 'manual',
            event: 'activity',
            event_type: 'stop',
        });
    }

    toFile() {
        return new File([this.fitParser.encode()], this.getFilename(), {type: 'application/binary'});
    }
}
