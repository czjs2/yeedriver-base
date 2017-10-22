/**
 * Created by zhuqizhong on 16-10-26.
 */
var Event = require('events');
var util = require('util');

var P = require('bluebird');

function InfinitLoop(){
    Event.EventEmitter.call(this);
}
util.inherits(InfinitLoop,Event.EventEmitter);
InfinitLoop.prototype.addRoutine = function(Routine,timeout){
    var eventName = 'finished-'+Math.random().toFixed(10);

    var self = this;
    var runner ;
    function doRoutine (){
            return P.resolve().then(function(){
                return Routine();
            }).delay(timeout || 10).catch(function(e){
                //console.error('error in read:',e ," and stack:",e.stack);
            }).finally(function(){
                setImmediate(function(){self.emit(eventName);});
            })
        }

    this.on(eventName,function(){
        runner = doRoutine();
    });
    runner = doRoutine();

};



// setInterval(function() {
//     console.log(process.memoryUsage());
// }, 200000);
module.exports = InfinitLoop;

