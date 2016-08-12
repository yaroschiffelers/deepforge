/*globals define, WebGMEGlobal*/
/*jshint browser: true*/

define([
    'js/Constants'
], function (
    CONSTANTS
) {

    'use strict';

    var ExecutionIndexControl;

    ExecutionIndexControl = function (options) {

        this._logger = options.logger.fork('Control');

        this._client = options.client;
        this._embedded = options.embedded;

        // Initialize core collections and variables
        this._widget = options.widget;

        this._currentNodeId = null;
        this.displayedExecutions = {};
        this._linesForExecution = {};
        this._lineToExec = {};
        this._pipelineNames = {};

        this._initWidgetEventHandlers();

        this._logger.debug('ctor finished');
    };

    ExecutionIndexControl.prototype._initWidgetEventHandlers = function () {
        this._widget.setExecutionDisplayed = this.setExecutionDisplayed.bind(this);
    };

    ExecutionIndexControl.prototype.setExecutionDisplayed = function (id, bool) {
        var lines = this._linesForExecution[id] || [],
            action = bool ? 'addNode' : 'removeNode';

        // If removing, just get the ids
        lines = bool ? lines : lines.map(line => line.id);

        this._logger.info(`setting execution ${id} to ${bool ? 'displayed' : 'hidden'}`);
        this.displayedExecutions[id] = bool;

        // update the given lines
        for (var i = lines.length; i--;) {
            this._widget[action](lines[i]);
        }
    };

    ExecutionIndexControl.prototype.clearTerritory = function () {
        if (this._territoryId) {
            this._client.removeUI(this._territoryId);
            this._territoryId = null;
        }
    };

    /* * * * * * * * Visualizer content update callbacks * * * * * * * */
    ExecutionIndexControl.prototype.selectedObjectChanged = function (nodeId) {
        var self = this;

        self._logger.debug('activeObject nodeId \'' + nodeId + '\'');

        // Remove current territory patterns
        self.clearTerritory();
        self._currentNodeId = nodeId;

        if (typeof self._currentNodeId === 'string') {
            // Create a territory for the executions
            self._selfPatterns = {};

            self._territoryId = self._client.addUI(self, function (events) {
                self._eventCallback(events);
            });

            // Update the territory
            self._selfPatterns[nodeId] = {children: 4};
            self._client.updateTerritory(self._territoryId, self._selfPatterns);
        }
    };

    // This next function retrieves the relevant node information for the widget
    ExecutionIndexControl.prototype._getObjectDescriptor = function (nodeId) {
        var node = this._client.getNode(nodeId),
            childIds,
            desc,
            base,
            type;

        if (node) {
            base = this._client.getNode(node.getBaseId());
            type = base.getAttribute('name');
            desc = {
                id: node.getId(),
                type: type,
                name: node.getAttribute('name')
            };

            if (type === 'Execution') {
                desc.status = node.getAttribute('status');
                desc.originTime = node.getAttribute('createdAt');
                desc.originId = node.getPointer('origin').to;
                desc.pipelineName = this._pipelineNames[desc.originId];
                this._logger.debug(`Looking up pipeline name for ${desc.name}: ${desc.pipelineName}`);

                // Create a territory for this origin and update it!
                this._selfPatterns[desc.originId] = {children: 0};
                setTimeout(() => this._client.updateTerritory(this._territoryId, this._selfPatterns), 0);
            } else if (type === 'Line') {
                desc = this.getLineDesc(node);
            } else if (type === 'Pipeline') {
                desc.execs = node.getMemberIds('executions');
                this._pipelineNames[desc.id] = desc.name;
            } else if (type === 'Graph') {
                childIds = node.getChildrenIds();
                desc.lines = childIds.map(id => {
                    var n = this._client.getNode(id);
                    return this.getLineDesc(n);
                });
            }
        }

        return desc;
    };

    ExecutionIndexControl.prototype.getLineDesc = function (node) {
        var id = node.getId(),
            graphId = node.getParentId(),
            jobId = this._client.getNode(graphId).getParentId(),
            execId = this._client.getNode(jobId).getParentId(),
            points,
            desc;

        points = node.getAttribute('points').split(';')
            .filter(data => !!data)  // remove any ''
            .map(pair => {
                var nums = pair.split(',').map(num => parseFloat(num));
                return {
                    x: nums[0],
                    y: nums[1]
                };
            });

        desc = {
            id: id,
            //execName: execName,
            execId: execId,
            lineName: node.getAttribute('name'),
            name: node.getAttribute('name'),
            type: 'line',
            points: points
        };

        // Update records
        if (!this._linesForExecution[execId]) {
            this._linesForExecution[execId] = [];
        }
        this._linesForExecution[execId].push(desc);
        this._lineToExec[id] = execId;

        return desc;
    };

    /* * * * * * * * Node Event Handling * * * * * * * */
    ExecutionIndexControl.prototype._eventCallback = function (events) {
        var event;

        events = events.filter(event => event.eid !== this._currentNodeId);

        this._logger.debug('received \'' + events.length + '\' events');

        for (var i = events.length; i--;) {
            event = events[i];
            switch (event.etype) {

            case CONSTANTS.TERRITORY_EVENT_LOAD:
                this._onLoad(event.eid);
                break;
            case CONSTANTS.TERRITORY_EVENT_UPDATE:
                this._onUpdate(event.eid);
                break;
            case CONSTANTS.TERRITORY_EVENT_UNLOAD:
                this._onUnload(event.eid);
                break;
            default:
                break;
            }
        }

        this._logger.debug('finished processing events!');
    };

    ExecutionIndexControl.prototype._onLoad = function (gmeId) {
        var desc = this._getObjectDescriptor(gmeId);
        this._logger.debug(`Loading node of type ${desc.type}`);
        if (desc.type === 'Execution') {
            this._logger.debug('Adding node to widget...');
            this._logger.debug('desc:', desc);
            this._widget.addNode(desc);
        } else if (desc.type === 'line' && this.isLineDisplayed(desc)) {
            this._widget.addNode(desc);
        } else if (desc.type === 'Pipeline') {
            this.updatePipelineNames(desc);
        }
    };

    ExecutionIndexControl.prototype._onUpdate = function (gmeId) {
        var desc = this._getObjectDescriptor(gmeId);
        if (desc.type === 'Execution') {
            this._widget.updateNode(desc);
        } else if (desc.type === 'line' && this.isLineDisplayed(desc)) {
            this._widget.updateNode(desc);
        } else if (desc.type === 'Pipeline') {
            this.updatePipelineNames(desc);
        }
    };

    ExecutionIndexControl.prototype.updatePipelineNames = function (desc) {
        // Get all associated executions and update their pipeline name
        this._logger.debug('updating pipeline name for ' + desc.execs.join(', '));
        for (var i = desc.execs.length; i--;) {
            this._widget.updatePipelineName(desc.execs[i], desc.name);
        }

        if (desc.execs.length === 0) {
            // Executions have been deleted - no longer relevant
            this._logger.debug('pipeline has 0 executions... removing it', desc.id);
            delete this._selfPatterns[desc.id];
            delete this._pipelineNames[desc.id];
        }
    };

    ExecutionIndexControl.prototype._onUnload = function (id) {
        var execId = this._lineToExec[id];

        if (execId) {  // it is a line
            delete this._lineToExec[id];
            for (var k = this._linesForExecution[execId].length; k--;) {
                if (this._linesForExecution[execId][k].id === id) {
                    this._linesForExecution[execId].splice(k, 1);
                    break;
                }
            }
        }

        this._widget.removeNode(id);
    };

    ExecutionIndexControl.prototype.isLineDisplayed = function (line) {
        // lines are only displayed if their execution is checked
        return this.displayedExecutions[line.execId];
    };

    ExecutionIndexControl.prototype._stateActiveObjectChanged = function (model, activeObjectId) {
        if (this._currentNodeId === activeObjectId) {
            // The same node selected as before - do not trigger
        } else {
            this.selectedObjectChanged(activeObjectId);
        }
    };

    /* * * * * * * * Visualizer life cycle callbacks * * * * * * * */
    ExecutionIndexControl.prototype.destroy = function () {
        this._detachClientEventListeners();
        this.clearTerritory();
    };

    ExecutionIndexControl.prototype._attachClientEventListeners = function () {
        this._detachClientEventListeners();
        if (!this._embedded) {
            WebGMEGlobal.State.on('change:' + CONSTANTS.STATE_ACTIVE_OBJECT,
                this._stateActiveObjectChanged, this);
        }
    };

    ExecutionIndexControl.prototype._detachClientEventListeners = function () {
        if (!this._embedded) {
            WebGMEGlobal.State.off('change:' + CONSTANTS.STATE_ACTIVE_OBJECT,
                this._stateActiveObjectChanged);
        }
    };

    ExecutionIndexControl.prototype.onActivate = function () {
        this._attachClientEventListeners();

        if (typeof this._currentNodeId === 'string') {
            WebGMEGlobal.State.registerSuppressVisualizerFromNode(true);
            WebGMEGlobal.State.registerActiveObject(this._currentNodeId);
            WebGMEGlobal.State.registerSuppressVisualizerFromNode(false);
        }
    };

    ExecutionIndexControl.prototype.onDeactivate = function () {
        this._detachClientEventListeners();
    };

    return ExecutionIndexControl;
});