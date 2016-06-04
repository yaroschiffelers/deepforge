/* globals define*/
// This is an 'executor' containing the implementations of all local operations
// These are all primitives in DeepForge
define([
], function(
) {
    'use strict';
    var LocalExecutor = function() {
    };

    // Should these be in lua?
    LocalExecutor.prototype.BlobLoader = function(node) {
        var hash = this.core.getAttribute(node, 'data');
        return this.getOutputs(node)
            .then(outputTuples => {
                var outputs = outputTuples.map(tuple => tuple[2]),
                    paths;

                paths = outputs.map(output => this.core.getPath(output));
                // Get the 'data' hash and store it in the output data ports
                this.logger.info(`Loading blob data (${hash}) to ${paths.map(p => `"${p}"`)}`);
                outputs.forEach(output => this.core.setAttribute(output, 'data', hash));

                // Set the metadata as appropriate
                // TODO
                this.onOperationComplete(node);
            });
    };

    LocalExecutor.prototype._getSaveDir = function () {
        return this.core.loadChildren(this.rootNode)
            .then(children => {
                var execPath = this.core.getPath(this.META.Data),
                    containers,
                    saveDir;

                // Find a node in the root that can contain only executions
                containers = children.filter(child => {
                    var metarule = this.core.getChildrenMeta(child);
                    return metarule && metarule[execPath];
                });

                if (containers.length > 1) {
                    saveDir = containers.find(c =>
                        this.core.getAttribute(c, 'name').toLowerCase().indexOf('artifacts') > -1
                    ) || containers[0];
                }

                return saveDir || this.rootNode;  // default to rootNode
            });
    };

    LocalExecutor.prototype.Save = function(node) {
        var nodeId = this.core.getPath(node),
            parentNode;
        
        // Get the input node
        this.logger.info('Calling save operation!');
        return this._getSaveDir()
            .then(_saveDir => {
                parentNode = _saveDir;
                return this.getInputs(node);
            })
            .then(inputs => {
                var ids = inputs.map(i => this.core.getPath(i[2])),
                    dataNodes;

                dataNodes = Object.keys(this.nodes)
                    .map(id => this.nodes[id])
                    .filter(node => this.isMetaTypeOf(node, this.META.Transporter))
                    .filter(node => 
                        ids.indexOf(this.core.getPointerPath(node, 'dst')) > -1
                    )
                    .map(node => this.core.getPointerPath(node, 'src'))
                    .map(id => this.nodes[id]);

                // get the input node
                if (dataNodes.length === 0) {
                    this.logger.error(`Could not find data to save! ${nodeId}`);
                } else {
                    var newNodes = this.core.copyNodes(dataNodes, parentNode),
                        newName = this.core.getOwnAttribute(node, 'saveName');
                    if (newName) {
                        newNodes.forEach(node =>
                            this.core.setAttribute(node, 'name', newName)
                        );
                    }
                }
                var hashes = dataNodes.map(n => this.core.getAttribute(n, 'data'));
                this.logger.info(`saving hashes: ${hashes.map(h => `"${h}"`)}`);
                this.onOperationComplete(node);
            });

        // Overwrite existing node w/ this name?
        // TODO
    };

    LocalExecutor.TYPES = Object.keys(LocalExecutor.prototype)
        .filter(name => name.indexOf('_') !== 0);
    
    return LocalExecutor;
});